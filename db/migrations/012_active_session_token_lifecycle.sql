BEGIN;

-- A browser keeps the same signed student-session token while the teacher may
-- authorize a new attempt. Historical revoked rows remain immutable audit data,
-- so token uniqueness belongs to the active-session lifecycle, not all history.
ALTER TABLE active_sessions
  DROP CONSTRAINT IF EXISTS active_sessions_session_token_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS active_sessions_active_token_hash_idx
  ON active_sessions (session_token_hash)
  WHERE status = 'active';

COMMIT;
