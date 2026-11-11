-- Relay M1. Apply once under the migration role; run the application with a
-- non-superuser role. All tenant data is additionally protected by RLS.
CREATE TABLE owners (
  id uuid PRIMARY KEY,
  telegram_user_id text NOT NULL UNIQUE CHECK (telegram_user_id ~ '^[0-9]{1,20}$'),
  private_chat_id text NOT NULL CHECK (private_chat_id ~ '^[0-9]{1,20}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE harnesses (
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  harness_id text NOT NULL CHECK (harness_id ~ '^h_[a-z0-9]{1,32}$'),
  active_version integer NOT NULL CHECK (active_version > 0),
  paused boolean NOT NULL DEFAULT false,
  capability_epoch bigint NOT NULL DEFAULT 0 CHECK (capability_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, harness_id)
);
CREATE TABLE harness_versions (
  owner_id uuid NOT NULL,
  harness_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, harness_id, version),
  FOREIGN KEY (owner_id, harness_id) REFERENCES harnesses(owner_id, harness_id) ON DELETE CASCADE
);
ALTER TABLE harnesses ADD CONSTRAINT harness_active_version_fk
  FOREIGN KEY (owner_id, harness_id, active_version)
  REFERENCES harness_versions(owner_id, harness_id, version)
  DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION reject_harness_version_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'harness versions are immutable'; END $$;
CREATE TRIGGER harness_versions_immutable BEFORE UPDATE ON harness_versions
  FOR EACH ROW EXECUTE FUNCTION reject_harness_version_update();
CREATE TABLE draft_sessions (
  owner_id uuid PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  harness_id text NOT NULL,
  base_version integer NOT NULL CHECK (base_version >= 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  cursor text NOT NULL,
  ui_revision integer NOT NULL CHECK (ui_revision > 0),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CHECK (harness_id ~ '^h_[a-z0-9]{1,32}$')
);
CREATE TABLE workspace_state (
  owner_id uuid PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_workspace ON workspace_state USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
CREATE TABLE inbox_updates (
  bot_id text NOT NULL CHECK (bot_id ~ '^[0-9]{1,20}$'),
  update_id text NOT NULL CHECK (update_id ~ '^[0-9]{1,20}$'),
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (bot_id, update_id)
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  dedup_key text NOT NULL CHECK (length(dedup_key) BETWEEN 1 AND 160),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed','unknown')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_id uuid,
  lease_expires_at timestamptz,
  telegram_message_id text,
  last_error_code text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, dedup_key)
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE status = 'pending';
CREATE TABLE callback_tokens (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  chat_id text NOT NULL CHECK (chat_id ~ '^[0-9]{1,20}$'),
  message_id text NOT NULL CHECK (message_id ~ '^[0-9]{1,20}$'),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  resource_id text,
  revision integer NOT NULL CHECK (revision >= 0),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  action text NOT NULL,
  resource_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Missing tenant context grants no access. FORCE covers table owners, although
-- PostgreSQL superusers and BYPASSRLS roles must never be used by the app.
ALTER TABLE harnesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE harnesses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_harnesses ON harnesses USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
ALTER TABLE harness_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE harness_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_versions ON harness_versions USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
ALTER TABLE draft_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_drafts ON draft_sessions USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_outbox ON outbox USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
ALTER TABLE callback_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE callback_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_callbacks ON callback_tokens USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit ON audit_events USING (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid) WITH CHECK (owner_id = NULLIF(current_setting('relay.owner_id', true), '')::uuid);
