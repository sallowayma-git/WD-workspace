CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organization (
    id uuid PRIMARY KEY,
    code varchar(50) NOT NULL,
    name varchar(200) NOT NULL,
    business_timezone varchar(64) NOT NULL,
    day_close_time time NOT NULL DEFAULT '05:00:00',
    carryover_horizon_days integer NOT NULL DEFAULT 90 CHECK (carryover_horizon_days BETWEEN 1 AND 366),
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_organization_code ON organization (code);

CREATE TABLE user_account (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization(id),
    username varchar(100) NOT NULL,
    display_name varchar(100) NOT NULL,
    email varchar(255),
    password_hash varchar(255) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),
    locale varchar(20) NOT NULL DEFAULT 'zh-CN',
    timezone varchar(64),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT uq_user_account_org_username UNIQUE (organization_id, username)
);
CREATE INDEX ix_user_account_org_status ON user_account (organization_id, status);

CREATE TABLE user_role_assignment (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization(id),
    user_id uuid NOT NULL REFERENCES user_account(id),
    role_code varchar(40) NOT NULL CHECK (role_code IN ('ADMIN', 'LEAD_TEACHER', 'ASSISTANT', 'VIEWER')),
    scope_type varchar(30) NOT NULL CHECK (scope_type IN ('ORGANIZATION', 'STUDENT_SET')),
    scope_id uuid,
    created_at timestamptz NOT NULL,
    created_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    version bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_user_role_scope ON user_role_assignment (organization_id, user_id, role_code, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE audit_event (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization(id),
    occurred_at timestamptz NOT NULL,
    actor_type varchar(20) NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM')),
    actor_id uuid,
    action varchar(80) NOT NULL,
    aggregate_type varchar(50) NOT NULL,
    aggregate_id uuid NOT NULL,
    correlation_id varchar(100) NOT NULL,
    before_data jsonb,
    after_data jsonb,
    metadata jsonb
);
CREATE INDEX ix_audit_event_org_occurred ON audit_event (organization_id, occurred_at DESC);

CREATE TABLE idempotency_record (
    organization_id uuid NOT NULL REFERENCES organization(id),
    idempotency_key varchar(200) NOT NULL,
    command_type varchar(80) NOT NULL,
    actor_id uuid NOT NULL,
    request_hash varchar(64) NOT NULL,
    status varchar(20) NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED')),
    result_type varchar(50),
    result_id uuid,
    response_snapshot jsonb,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, idempotency_key)
);
