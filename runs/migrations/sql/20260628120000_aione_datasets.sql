CREATE TABLE IF NOT EXISTS aione_datasets (
  id TEXT NOT NULL,
  org TEXT NOT NULL,
  project TEXT NOT NULL,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cloud_storage_id TEXT NOT NULL,
  folder_path TEXT NOT NULL DEFAULT '',
  project_public BOOLEAN NOT NULL DEFAULT FALSE,
  creator TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org, project, domain, id)
);

CREATE INDEX IF NOT EXISTS idx_aione_datasets_project_domain_created_at
  ON aione_datasets (org, project, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aione_datasets_project_domain_name
  ON aione_datasets (org, project, domain, name);

CREATE INDEX IF NOT EXISTS idx_aione_datasets_project_domain_cloud_storage
  ON aione_datasets (org, project, domain, cloud_storage_id);
