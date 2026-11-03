CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  daily_limit INTEGER NOT NULL DEFAULT 1000,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

CREATE TABLE IF NOT EXISTS usage_daily (
  api_key_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, usage_date),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);
CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily(usage_date);
