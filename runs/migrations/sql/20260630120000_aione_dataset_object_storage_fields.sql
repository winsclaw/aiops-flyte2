ALTER TABLE aione_datasets
  ADD COLUMN IF NOT EXISTS end_point TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS port TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS secret_key_ciphertext TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_path TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bucket TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bucket_path TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_aione_datasets_project_domain_cloud_storage;

ALTER TABLE aione_datasets
  DROP COLUMN IF EXISTS cloud_storage_id,
  DROP COLUMN IF EXISTS folder_path,
  DROP COLUMN IF EXISTS project_public;

CREATE INDEX IF NOT EXISTS idx_aione_datasets_project_domain_bucket
  ON aione_datasets (org, project, domain, bucket);
