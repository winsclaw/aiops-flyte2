CREATE TABLE IF NOT EXISTS aione_code_repositories (
  id TEXT NOT NULL,
  org TEXT NOT NULL,
  project TEXT NOT NULL,
  domain TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  access_token TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org, project, domain, id)
);

CREATE INDEX IF NOT EXISTS idx_aione_code_repositories_project_domain_created_at
  ON aione_code_repositories (org, project, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aione_code_repositories_project_domain_repo_url
  ON aione_code_repositories (org, project, domain, repo_url);
