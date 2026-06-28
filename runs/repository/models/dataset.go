package models

import "time"

type DatasetKey struct {
	Org     string `db:"org"`
	Project string `db:"project"`
	Domain  string `db:"domain"`
	ID      string `db:"id"`
}

type Dataset struct {
	DatasetKey

	Name           string    `db:"name"`
	Description    string    `db:"description"`
	CloudStorageID string    `db:"cloud_storage_id"`
	FolderPath     string    `db:"folder_path"`
	ProjectPublic  bool      `db:"project_public"`
	Creator        string    `db:"creator"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type DatasetListInput struct {
	Org     string
	Project string
	Domain  string
	Search  string
	Limit   uint32
	Offset  uint32
}

type DatasetListResult struct {
	Items []*Dataset
	Total uint32
}
