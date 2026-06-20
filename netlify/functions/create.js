const { createClient } = require('@supabase/supabase-js');

// Simple in-memory rate limiter: max 10 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_WINDOW_MS) {
    // Reset window
    entry.count = 1;
    entry.windowStart = now;
    rateLimitMap.set(ip, entry);
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  rateLimitMap.set(ip, entry);
  return true;
}

// Clean up old entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Sanitisation patterns — catch prompt injection attempts
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now/i,
  /act\s+as/i,
  /system\s*:/i,
  /assistant\s*:/i,
  /user\s*:/i,
  /<\s*script/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,   // onclick= onerror= etc
];

function sanitise(text) {
  if (!text || typeof text !== 'string') return null;

  // Trim and cap length
  let s = text.trim().slice(0, 500);

  // Basic XSS strip — remove HTML tags
  s = s.replace(/<[^>]*>/g, '');

  // Check for injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(s)) return null;
  }

  return s;
}

// Generate a 7-char alphanumeric short ID (no external deps)
function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 7; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Rate limit by IP
  const ip =
    event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    event.headers['client-ip'] ||
    'unknown';

  if (!checkRateLimit(ip)) {
    return {
      statusCode: 429,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Whoa there. You're generating a lot of lazy links. Slow down.",
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { query, submitter, ai_target = 'claude', currency = 'USD' } = body;

  // Sanitise the query
  const cleanQuery = sanitise(query);
  if (!cleanQuery) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: "Ooh, sneaky. We don't allow prompt injection here. Try asking something genuine.",
      }),
    };
  }

  if (cleanQuery.length < 3) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "That query's too short to be lazy. Try harder." }),
    };
  }

  // Sanitise optional fields
  const cleanSubmitter = submitter ? submitter.trim().slice(0, 100).replace(/<[^>]*>/g, '') || null : null;
  const validTargets = ['claude', 'chatgpt', 'perplexity', 'gemini'];
  const cleanTarget = validTargets.includes(ai_target) ? ai_target : 'claude';
  const validCurrencies = ['USD', 'GBP', 'EUR', 'AED'];
  const cleanCurrency = validCurrencies.includes(currency) ? currency : 'USD';

  // Token & cost estimation (Claude Sonnet pricing)
  const inputTokens = Math.ceil(cleanQuery.length / 4);
  const outputTokens = inputTokens * 4;
  const totalTokens = inputTokens + outputTokens;
  const estCostUsd = (inputTokens / 1_000_000 * 3) + (outputTokens / 1_000_000 * 15);

  // Generate unique short ID
  const id = generateId();

  // Insert into Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await supabase.from('queries').insert({
    id,
    query: cleanQuery,
    submitter: cleanSubmitter,
    ai_target: cleanTarget,
    est_tokens: totalTokens,
    est_cost_usd: estCostUsd,
    currency: cleanCurrency,
  });

  if (error) {
    console.error('Supabase insert error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to save your laziness. Try again.' }),
    };
  }

  const shortUrl = `https://letmeaithatforya.com/q/${id}`;

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      shortUrl,
      est_tokens: totalTokens,
      est_cost_usd: estCostUsd,
      currency: cleanCurrency,
    }),
  };
};
