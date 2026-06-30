ALTER TABLE training_tasks
  ADD COLUMN IF NOT EXISTS datasets_json TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS dataset_mounts_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE development_instances
  ADD COLUMN IF NOT EXISTS datasets_json TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS dataset_mounts_json TEXT NOT NULL DEFAULT '[]';
