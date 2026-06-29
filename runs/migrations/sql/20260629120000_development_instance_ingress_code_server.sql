ALTER TABLE development_instances
    ADD COLUMN IF NOT EXISTS enable_ssh BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE development_instances
    DROP COLUMN IF EXISTS code_server_node_port;

ALTER TABLE development_instance_runs
    DROP COLUMN IF EXISTS code_server_node_port;
