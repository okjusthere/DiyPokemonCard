-- Where a purchase started: the first page of the session and an optional campaign tag from our own links.
ALTER TABLE checkout_sessions ADD COLUMN landing TEXT;
ALTER TABLE checkout_sessions ADD COLUMN campaign TEXT;
-- The cleanup job and the trial counter look accounts up by age and by connection.
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);
CREATE INDEX IF NOT EXISTS idx_trial_claims_account_id ON trial_claims(account_id);
