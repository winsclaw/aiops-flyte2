ALTER TABLE training_tasks
  ADD COLUMN IF NOT EXISTS cloud_storage_mounts_json TEXT NOT NULL DEFAULT '[]';
