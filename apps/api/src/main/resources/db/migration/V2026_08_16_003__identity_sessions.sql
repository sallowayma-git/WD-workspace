ALTER TABLE user_account
    ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN locked_until timestamptz,
    ADD COLUMN password_changed_at timestamptz;

ALTER TABLE user_account
    ADD CONSTRAINT ck_user_account_failed_login_attempts CHECK (failed_login_attempts >= 0);

CREATE TABLE auth_session (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization(id),
    user_id uuid NOT NULL REFERENCES user_account(id),
    access_token_hash varchar(64) NOT NULL,
    refresh_token_hash varchar(64) NOT NULL,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_reason varchar(40),
    rotated_from_session_id uuid REFERENCES auth_session(id),
    replaced_by_session_id uuid REFERENCES auth_session(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT uq_auth_session_access_hash UNIQUE (access_token_hash),
    CONSTRAINT uq_auth_session_refresh_hash UNIQUE (refresh_token_hash),
    CONSTRAINT ck_auth_session_expiry CHECK (refresh_expires_at >= access_expires_at)
);
CREATE INDEX ix_auth_session_user_active ON auth_session (user_id, revoked_at, refresh_expires_at);
CREATE INDEX ix_auth_session_org_active ON auth_session (organization_id, revoked_at);
