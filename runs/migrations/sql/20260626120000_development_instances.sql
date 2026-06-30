CREATE TABLE IF NOT EXISTS development_instances (
    id TEXT PRIMARY KEY,
    org TEXT NOT NULL,
    project TEXT NOT NULL,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    source_system TEXT NOT NULL DEFAULT '',
    resource_display TEXT NOT NULL DEFAULT '',
    cpu TEXT NOT NULL DEFAULT '',
    memory TEXT NOT NULL DEFAULT '',
    gpu_count INTEGER NOT NULL DEFAULT 0,
    gpu_model TEXT NOT NULL DEFAULT '',
    bandwidth TEXT NOT NULL DEFAULT '',
    workspace_size TEXT NOT NULL DEFAULT '',
    max_hours INTEGER NOT NULL DEFAULT 24,
    image_type TEXT NOT NULL DEFAULT '',
    official_image_id TEXT NOT NULL DEFAULT '',
    image_name TEXT NOT NULL DEFAULT '',
    image_uri TEXT NOT NULL DEFAULT '',
    image_pull_secret_name TEXT NOT NULL DEFAULT '',
    code_repository_secret_name TEXT NOT NULL DEFAULT '',
    gpu_node_label_key TEXT NOT NULL DEFAULT '',
    base_image_mount_path TEXT NOT NULL DEFAULT '',
    enable_ssh BOOLEAN NOT NULL DEFAULT FALSE,
    ssh_user TEXT NOT NULL DEFAULT 'dev',
    authorized_keys_json TEXT NOT NULL DEFAULT '[]',
    workspace_pvc_name TEXT NOT NULL DEFAULT '',
    latest_run_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'NOT_STARTED',
    generation INTEGER NOT NULL DEFAULT 0,
    node_port INTEGER NOT NULL DEFAULT 0,
    code_server_url TEXT NOT NULL DEFAULT '',
    code_server_workspace_url TEXT NOT NULL DEFAULT '',
    cloud_storage_mounts_json TEXT NOT NULL DEFAULT '[]',
    code_repository_mounts_json TEXT NOT NULL DEFAULT '[]',
    datasets_json TEXT NOT NULL DEFAULT '[]',
    dataset_mounts_json TEXT NOT NULL DEFAULT '[]',
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS development_instances_project_idx
    ON development_instances (org, project, domain, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS development_instances_latest_run_name_idx
    ON development_instances (latest_run_name);

CREATE TABLE IF NOT EXISTS development_instance_runs (
    id BIGSERIAL PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES development_instances(id) ON DELETE CASCADE,
    org TEXT NOT NULL,
    project TEXT NOT NULL,
    domain TEXT NOT NULL,
    run_name TEXT NOT NULL,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'STARTING',
    node_port INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project, domain, run_name),
    UNIQUE (instance_id, generation)
);

CREATE INDEX IF NOT EXISTS development_instance_runs_instance_idx
    ON development_instance_runs (instance_id, generation DESC);
