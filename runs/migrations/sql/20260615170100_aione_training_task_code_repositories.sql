ALTER TABLE training_tasks
  ADD COLUMN IF NOT EXISTS code_repository_mounts_json TEXT NOT NULL DEFAULT '[]';
