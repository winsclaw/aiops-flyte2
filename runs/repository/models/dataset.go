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

	Name                string    `db:"name"`
	Description         string    `db:"description"`
	EndPoint            string    `db:"end_point"`
	Port                string    `db:"port"`
	AccessKey           string    `db:"access_key"`
	SecretKeyCiphertext string    `db:"secret_key_ciphertext"`
	TargetPath          string    `db:"target_path"`
	Bucket              string    `db:"bucket"`
	BucketPath          string    `db:"bucket_path"`
	Creator             string    `db:"creator"`
	CreatedAt           time.Time `db:"created_at"`
	UpdatedAt           time.Time `db:"updated_at"`
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
