/**
 * daily-agent.js — Netlify Function (POST)
 *
 * Pulls queries from the last 24 hours, generates punchy social captions
 * using Claude Haiku, and logs them. Scheduler push is stubbed below.
 *
 * TODO: Replace the stubbed section with a real push to Hootsuite/Later API
 * once API credentials are set up. See the "STUB: Push to scheduler" comment.
 */

const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Fetch all queries from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error: fetchError } = await supabase
    .from('queries')
    .select('id, query, est_cost_usd, currency')
    .gte('created_at', since);

  if (fetchError) {
    console.error('Supabase fetch error:', fetchError);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to fetch recent queries.' }),
    };
  }

  if (!rows || rows.length === 0) {
    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'No queries in the last 24 hours. Slow day.', captions: [] }),
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured.' }),
    };
  }

  const captions = [];

  for (const row of rows) {
    const costStr = row.est_cost_usd
      ? `$${parseFloat(row.est_cost_usd).toFixed(6)}`
      : 'a fraction of a cent';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 100,
          system:
            "You write funny, punchy social media captions for a site called 'Let Me AI That For Ya' — a parody of LMGTFY. Keep it under 200 chars. Be witty and savage about laziness.",
          messages: [
            {
              role: 'user',
              content: `Write a caption for this lazy question: '${row.query}'. It cost approximately ${costStr} to answer.`,
            },
          ],
        }),
      });

      const json = await response.json();
      const caption = json?.content?.[0]?.text?.trim() || '(no caption generated)';
      captions.push({ query: row.query, caption, cost: row.est_cost_usd });
      console.log(`[daily-agent] Caption for "${row.query}": ${caption}`);
    } catch (err) {
      console.error(`[daily-agent] Failed to generate caption for query ${row.id}:`, err);
      captions.push({ query: row.query, caption: '(generation failed)', cost: row.est_cost_usd });
    }
  }

  // -------------------------------------------------------------------
  // STUB: Push to scheduler (Hootsuite / Later / Buffer)
  //
  // TODO: When you have API credentials, replace this block with real calls.
  // Example (Hootsuite):
  //   for (const { caption } of captions) {
  //     await fetch('https://platform.hootsuite.com/v1/messages', {
  //       method: 'POST',
  //       headers: { Authorization: `Bearer ${process.env.HOOTSUITE_TOKEN}`, 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ text: caption, scheduledSendTime: ..., socialProfileIds: [...] }),
  //     });
  //   }
  //
  // For now: just log captions to console and return them.
  // -------------------------------------------------------------------
  console.log('[daily-agent] STUB: Would push', captions.length, 'captions to scheduler.');

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ captions }),
  };
};
