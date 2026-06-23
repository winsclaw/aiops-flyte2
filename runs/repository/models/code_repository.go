package models

import "time"

type CodeRepositoryKey struct {
	Org     string `db:"org"`
	Project string `db:"project"`
	Domain  string `db:"domain"`
	ID      string `db:"id"`
}

type CodeRepository struct {
	CodeRepositoryKey

	RepoURL     string    `db:"repo_url"`
	Branch      string    `db:"branch"`
	MountPath   string    `db:"mount_path"`
	AccessToken string    `db:"access_token"`
	Creator     string    `db:"creator"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}

type CodeRepositoryListInput struct {
	Org     string
	Project string
	Domain  string
	Search  string
	Limit   uint32
	Offset  uint32
}

type CodeRepositoryListResult struct {
	Items []*CodeRepository
	Total uint32
}
