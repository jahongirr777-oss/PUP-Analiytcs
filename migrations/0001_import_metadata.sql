-- Metadata only: operational CSV columns require an agreed mapping first.
PRAGMA foreign_keys = ON;
CREATE TABLE datasets (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('staging', 'ready', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('dispatch', 'delivery')),
  file_sha256 TEXT NOT NULL CHECK (length(file_sha256) = 64),
  mapping_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'validated', 'failed')),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  rejected_rows INTEGER NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  checkpoint TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (dataset_id, source_kind, file_sha256, mapping_version)
);
CREATE TABLE active_dataset (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  dataset_id TEXT NOT NULL REFERENCES datasets(id)
);
CREATE TRIGGER active_dataset_insert_ready
BEFORE INSERT ON active_dataset
WHEN NOT EXISTS (SELECT 1 FROM datasets WHERE id = NEW.dataset_id AND state = 'ready')
BEGIN SELECT RAISE(ABORT, 'dataset_not_ready'); END;
CREATE TRIGGER active_dataset_update_ready
BEFORE UPDATE ON active_dataset
WHEN NOT EXISTS (SELECT 1 FROM datasets WHERE id = NEW.dataset_id AND state = 'ready')
BEGIN SELECT RAISE(ABORT, 'dataset_not_ready'); END;
CREATE TRIGGER active_dataset_remains_ready
BEFORE UPDATE OF state ON datasets
WHEN NEW.state <> 'ready' AND EXISTS (SELECT 1 FROM active_dataset WHERE dataset_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'active_dataset_must_remain_ready'); END;
