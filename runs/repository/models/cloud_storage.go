package models

import "time"

type CloudStorageKey struct {
	Org     string `db:"org"`
	Project string `db:"project"`
	Domain  string `db:"domain"`
	ID      string `db:"id"`
}

type CloudStorage struct {
	CloudStorageKey

	Name             string            `db:"name"`
	Description      string            `db:"description"`
	SizeGB           uint32            `db:"size_gb"`
	StorageClass     string            `db:"storage_class"`
	TargetNamespace  string            `db:"-"`
	PVCName          string            `db:"-"`
	Creator          string            `db:"creator"`
	MaterializedAt   time.Time         `db:"-"`
	CreatedAt        time.Time         `db:"created_at"`
	UpdatedAt        time.Time         `db:"updated_at"`
	Materializations []CloudStoragePVC `db:"-"`
}

type CloudStoragePVC struct {
	CloudStorageKey

	TargetNamespace string    `db:"target_namespace"`
	PVCName         string    `db:"pvc_name"`
	MaterializedAt  time.Time `db:"materialized_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

type CloudStorageListInput struct {
	Org     string
	Project string
	Domain  string
	Search  string
	Limit   uint32
	Offset  uint32
}

type CloudStorageListResult struct {
	Items []*CloudStorage
	Total uint32
}
