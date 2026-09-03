-- Store only keyed digests so throttling coordinates across application
-- instances without persisting raw network or account identifiers.

BEGIN;

CREATE TABLE teacher_login_rate_limits (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ip', 'account')),
  scope_hash TEXT NOT NULL CHECK (scope_hash ~ '^[A-Za-z0-9_-]{43}$'),
  attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_type, scope_hash),
  CHECK (expires_at > window_started_at),
  CHECK (updated_at >= window_started_at)
);

CREATE INDEX teacher_login_rate_limits_expiry_idx
  ON teacher_login_rate_limits (expires_at);

CREATE INDEX teacher_login_rate_limits_updated_idx
  ON teacher_login_rate_limits (updated_at DESC, scope_type, scope_hash);

INSERT INTO schema_migrations (version, filename, description)
VALUES (24, '024_teacher_login_rate_limits.sql', 'Cross-instance teacher sign-in throttling');

COMMIT;
