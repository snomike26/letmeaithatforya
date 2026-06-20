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

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Fetch all rows with a non-null/non-empty submitter
  // Supabase doesn't support GROUP BY via the JS client directly,
  // so we fetch and aggregate server-side (fine for small datasets)
  const { data, error } = await supabase
    .from('queries')
    .select('submitter, est_tokens, est_cost_usd')
    .not('submitter', 'is', null)
    .neq('submitter', '');

  if (error) {
    console.error('Supabase leaderboard error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to load the hall of shame.' }),
    };
  }

  // Aggregate by submitter
  const totals = {};
  for (const row of (data || [])) {
    const name = row.submitter;
    if (!totals[name]) {
      totals[name] = { name, total_tokens: 0, total_cost_usd: 0, query_count: 0 };
    }
    totals[name].total_tokens += (row.est_tokens || 0);
    totals[name].total_cost_usd += parseFloat(row.est_cost_usd || 0);
    totals[name].query_count++;
  }

  // Sort by total_tokens descending, take top 5
  const top5 = Object.values(totals)
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .slice(0, 5)
    .map(entry => ({
      ...entry,
      total_cost_usd: parseFloat(entry.total_cost_usd.toFixed(6)),
    }));

  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaderboard: top5 }),
  };
};
