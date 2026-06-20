-- letmeaithatforya — Supabase setup SQL
-- Paste this into the Supabase SQL editor and run it.

CREATE TABLE queries (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  submitter TEXT,
  ai_target TEXT NOT NULL DEFAULT 'claude',
  est_tokens INTEGER,
  est_cost_usd NUMERIC(10,6),
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for daily agent sweep
CREATE INDEX idx_queries_created_at ON queries(created_at);

-- Index for leaderboard
CREATE INDEX idx_queries_submitter ON queries(submitter);
