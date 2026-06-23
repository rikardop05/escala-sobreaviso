-- ============================================================
-- Escala de Sobreaviso — PostgreSQL Schema
-- Target schema for migrating from Redis JSON blobs to a
-- relational database. Endpoints still use Redis until the
-- migration is executed.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================

CREATE TYPE user_role   AS ENUM ('admin', 'member', 'viewer');
CREATE TYPE entry_kind  AS ENUM ('SA', 'HE', 'Comp');
CREATE TYPE audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- ============================================================
-- team_members
-- The fixed roster defined in src/lib/schedule.js.
-- Stored here so FKs can reference names and to allow
-- colour/active-state changes without a code deploy.
-- ============================================================
CREATE TABLE team_members (
  name       TEXT PRIMARY KEY,       -- "Ricardo", "Raul", …
  color      TEXT,                   -- hex, e.g. "#1565C0"
  bg_color   TEXT,                   -- hex background
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO team_members (name, color, bg_color) VALUES
  ('Emanoel',       '#7B1FA2', '#F3E5F5'),
  ('Marcus Túlio',  '#2E7D32', '#E8F5E9'),
  ('Ricardo',       '#1565C0', '#E3F2FD'),
  ('Carlos',        '#37474F', '#ECEFF1'),
  ('Raul',          '#E65100', '#FFF3E0'),
  ('Alice',         '#AD1457', '#FCE4EC');

-- ============================================================
-- users
-- One row per Clerk account. member_id links the Clerk
-- identity to the team roster (set once during ProfileSetup).
-- ============================================================
CREATE TABLE users (
  id         BIGSERIAL PRIMARY KEY,
  clerk_id   TEXT NOT NULL UNIQUE,   -- JWT sub claim
  email      TEXT NOT NULL,
  role       user_role NOT NULL DEFAULT 'member',
  member_id  TEXT REFERENCES team_members(name) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_clerk_id ON users (clerk_id);

-- ============================================================
-- shift_params
-- Monthly salary / workday parameters per user.
-- One row = one user's CH configuration for a given month.
-- month is stored as the first day of that month (e.g. 2026-06-01).
-- ============================================================
CREATE TABLE shift_params (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       DATE NOT NULL,          -- first day of month
  remuneracao NUMERIC(12,2),          -- gross monthly salary (BRL)
  jornada     INTEGER,                -- nominal hours per working day
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month)
);

CREATE INDEX idx_shift_params_user_month ON shift_params (user_id, month);

-- ============================================================
-- hour_entries
-- Individual time-tracking rows (SA, HE, Comp) per user.
-- fim may represent a time on the following day (e.g. 23:00–04:00);
-- duration logic already handles this in the frontend.
-- ============================================================
CREATE TABLE hour_entries (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  kind       entry_kind NOT NULL,     -- 'SA' | 'HE' | 'Comp'
  inicio     TIME,                    -- start time
  fim        TIME,                    -- end time (may cross midnight)
  obs        TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hour_entries_user_date ON hour_entries (user_id, entry_date);

-- ============================================================
-- substitutions
-- Covers the "titular is absent, substituto takes their shifts"
-- relationship for a date range. Created_by tracks who logged it.
-- ============================================================
CREATE TABLE substitutions (
  id          BIGSERIAL PRIMARY KEY,
  titular     TEXT NOT NULL REFERENCES team_members(name) ON UPDATE CASCADE,
  substituto  TEXT NOT NULL REFERENCES team_members(name) ON UPDATE CASCADE,
  from_date   DATE NOT NULL,
  until_date  DATE NOT NULL,
  created_by  BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_sub_dates   CHECK (from_date <= until_date),
  CONSTRAINT ck_sub_persons CHECK (titular <> substituto)
);

CREATE INDEX idx_substitutions_range    ON substitutions (from_date, until_date);
CREATE INDEX idx_substitutions_titular  ON substitutions (titular);

-- ============================================================
-- audit_log
-- Immutable record of mutations to tables that contain
-- financial data (shift_params, hour_entries).
-- old_data / new_data store the full row as JSONB for forensics.
-- ============================================================
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  table_name TEXT NOT NULL,
  record_id  BIGINT,
  action     audit_action NOT NULL,
  old_data   JSONB,
  new_data   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor     ON audit_log (actor_id);
CREATE INDEX idx_audit_table_rec ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_when      ON audit_log (created_at DESC);

-- ============================================================
-- updated_at trigger (apply to users, shift_params, hour_entries)
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_shift_params_updated_at
  BEFORE UPDATE ON shift_params
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_hour_entries_updated_at
  BEFORE UPDATE ON hour_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
