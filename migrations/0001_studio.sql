
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT,
      promo_credits_remaining INTEGER NOT NULL DEFAULT 1,
      terms_accepted_at TEXT,
      privacy_accepted_at TEXT,
      photo_parent_consent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_attempts (
      request_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      charge_source TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      refunded_at TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_results (
      request_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      image_url TEXT NOT NULL,
      card_data_json TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(request_id) REFERENCES generation_attempts(request_id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS checkout_sessions (
      stripe_session_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT,
      plan TEXT NOT NULL,
      credits_added INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_account_id ON credit_ledger(account_id);
    CREATE INDEX IF NOT EXISTS idx_generation_attempts_account_id ON generation_attempts(account_id);
    CREATE INDEX IF NOT EXISTS idx_generation_results_account_id ON generation_results(account_id);
    CREATE INDEX IF NOT EXISTS idx_checkout_sessions_account_id ON checkout_sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_account_id ON auth_tokens(account_id);
  
CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trial_claims (identity_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, claimed_at TEXT DEFAULT (datetime('now')));
