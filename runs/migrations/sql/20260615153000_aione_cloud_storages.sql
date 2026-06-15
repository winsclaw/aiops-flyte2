CREATE TABLE IF NOT EXISTS aione_cloud_storages (
  id TEXT NOT NULL,
  org TEXT NOT NULL,
  project TEXT NOT NULL,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  size_gb INTEGER NOT NULL,
  storage_class TEXT NOT NULL DEFAULT 'bj1-ebs',
  creator TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org, project, domain, id)
);

CREATE INDEX IF NOT EXISTS idx_aione_cloud_storages_project_domain_created_at
  ON aione_cloud_storages (org, project, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aione_cloud_storages_project_domain_name
  ON aione_cloud_storages (org, project, domain, name);

CREATE TABLE IF NOT EXISTS aione_cloud_storage_pvcs (
  org TEXT NOT NULL,
  project TEXT NOT NULL,
  domain TEXT NOT NULL,
  cloud_storage_id TEXT NOT NULL,
  target_namespace TEXT NOT NULL,
  pvc_name TEXT NOT NULL,
  materialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org, project, domain, cloud_storage_id, target_namespace),
  FOREIGN KEY (org, project, domain, cloud_storage_id)
    REFERENCES aione_cloud_storages (org, project, domain, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_aione_cloud_storage_pvcs_storage
  ON aione_cloud_storage_pvcs (org, project, domain, cloud_storage_id);
