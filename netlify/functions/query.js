const { createClient } = require('@supabase/supabase-js');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const id = event.queryStringParameters?.id;

  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9]{1,20}$/.test(id)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing or invalid id parameter' }),
    };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('queries')
    .select('id, query, submitter, ai_target, est_tokens, est_cost_usd, currency, created_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    return {
      statusCode: 404,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Link not found. Maybe they gave up already.' }),
    };
  }

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
};
