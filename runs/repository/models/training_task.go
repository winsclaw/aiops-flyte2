package models

import (
	"time"

	"k8s.io/apimachinery/pkg/util/sets"
)

var TrainingTaskColumns = sets.New(
	"id",
	"org",
	"project",
	"domain",
	"name",
	"description",
	"resource_spec_id",
	"resource_display",
	"created_at",
	"updated_at",
)

type TrainingTaskKey struct {
	Org     string `db:"org"`
	Project string `db:"project"`
	Domain  string `db:"domain"`
	ID      string `db:"id"`
}

type TrainingTask struct {
	TrainingTaskKey

	Name            string    `db:"name"`
	Description     string    `db:"description"`
	ResourceSpecID  string    `db:"resource_spec_id"`
	ResourceDisplay string    `db:"resource_display"`
	CPU             string    `db:"cpu"`
	Memory          string    `db:"memory"`
	GPUCount        uint32    `db:"gpu_count"`
	GPUModel        string    `db:"gpu_model"`
	Bandwidth       string    `db:"bandwidth"`
	Command         string    `db:"command"`
	MaxRuntimeHours uint32    `db:"max_runtime_hours"`
	ImageType       string    `db:"image_type"`
	OfficialImageID string    `db:"official_image_id"`
	ImageName       string    `db:"image_name"`
	ImageURI        string    `db:"image_uri"`
	Creator         string    `db:"creator"`
	LatestRunName   string    `db:"latest_run_name"`
	CreatedAt       time.Time `db:"created_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

type TrainingTaskListInput struct {
	Org     string
	Project string
	Domain  string
	Search  string
	Limit   uint32
	Offset  uint32
}

type TrainingTaskListResult struct {
	Items []*TrainingTask
	Total uint32
}
