CREATE TABLE IF NOT EXISTS training_tasks (
  id TEXT NOT NULL,
  org TEXT NOT NULL,
  project TEXT NOT NULL,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  resource_spec_id TEXT NOT NULL,
  resource_display TEXT NOT NULL,
  cpu TEXT NOT NULL,
  memory TEXT NOT NULL,
  gpu_count INTEGER NOT NULL DEFAULT 0,
  gpu_model TEXT NOT NULL DEFAULT '',
  bandwidth TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  max_runtime_hours INTEGER NOT NULL,
  image_type TEXT NOT NULL,
  official_image_id TEXT NOT NULL DEFAULT '',
  image_name TEXT NOT NULL,
  image_uri TEXT NOT NULL,
  creator TEXT NOT NULL DEFAULT '',
  latest_run_name TEXT NOT NULL DEFAULT '',
  datasets_json TEXT NOT NULL DEFAULT '[]',
  dataset_mounts_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org, project, domain, id)
);

CREATE INDEX IF NOT EXISTS idx_training_tasks_project_domain_created_at
  ON training_tasks (org, project, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_training_tasks_project_domain_name
  ON training_tasks (org, project, domain, name);
