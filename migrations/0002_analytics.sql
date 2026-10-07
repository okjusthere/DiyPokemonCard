-- Aggregate, cookie-free usage counts. Never store photos, card text, names, emails or prompts here.
CREATE TABLE IF NOT EXISTS daily_metrics (day TEXT NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, name));
-- Visitor hashes use a random per-day salt. The scheduled job deletes both after two days.
CREATE TABLE IF NOT EXISTS daily_visitors (day TEXT NOT NULL, visitor_hash TEXT NOT NULL, PRIMARY KEY(day, visitor_hash));
CREATE TABLE IF NOT EXISTS analytics_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
-- The weekly report reads these tables by date range.
CREATE INDEX IF NOT EXISTS idx_generation_attempts_created_at ON generation_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_completed_at ON checkout_sessions(completed_at);
