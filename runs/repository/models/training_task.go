package models

import (
	"encoding/json"
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

	Name                     string                            `db:"name"`
	Description              string                            `db:"description"`
	ResourceSpecID           string                            `db:"resource_spec_id"`
	ResourceDisplay          string                            `db:"resource_display"`
	CPU                      string                            `db:"cpu"`
	Memory                   string                            `db:"memory"`
	GPUCount                 uint32                            `db:"gpu_count"`
	GPUModel                 string                            `db:"gpu_model"`
	Bandwidth                string                            `db:"bandwidth"`
	Command                  string                            `db:"command"`
	MaxRuntimeHours          uint32                            `db:"max_runtime_hours"`
	ImageType                string                            `db:"image_type"`
	OfficialImageID          string                            `db:"official_image_id"`
	ImageName                string                            `db:"image_name"`
	ImageURI                 string                            `db:"image_uri"`
	Creator                  string                            `db:"creator"`
	LatestRunName            string                            `db:"latest_run_name"`
	CloudStorageMountsJSON   string                            `db:"cloud_storage_mounts_json"`
	CodeRepositoryMountsJSON string                            `db:"code_repository_mounts_json"`
	DatasetsJSON             string                            `db:"datasets_json"`
	DatasetMountsJSON        string                            `db:"dataset_mounts_json"`
	CloudStorageMounts       []TrainingTaskCloudStorageMount   `db:"-"`
	CodeRepositoryMounts     []TrainingTaskCodeRepositoryMount `db:"-"`
	Datasets                 []RuntimeDataset                  `db:"-"`
	DatasetMounts            []DatasetMount                    `db:"-"`
	CreatedAt                time.Time                         `db:"created_at"`
	UpdatedAt                time.Time                         `db:"updated_at"`
}

type TrainingTaskCloudStorageMount struct {
	CloudStorageID   string `json:"cloudStorageId"`
	PVCName          string `json:"pvcName,omitempty"`
	StorageClassName string `json:"storageClassName,omitempty"`
	Size             string `json:"size,omitempty"`
	MountPath        string `json:"mountPath"`
}

type TrainingTaskCodeRepositoryMount struct {
	CodeRepositoryID string `json:"codeRepositoryId"`
	RepoURL          string `json:"repoUrl,omitempty"`
	Branch           string `json:"branch,omitempty"`
	MountPath        string `json:"mountPath"`
	Token            string `json:"token,omitempty"`
}

func (t *TrainingTask) SelectedCloudStorageMounts() []TrainingTaskCloudStorageMount {
	if t == nil {
		return nil
	}
	if len(t.CloudStorageMounts) > 0 {
		return t.CloudStorageMounts
	}
	mounts, _ := DecodeTrainingTaskCloudStorageMounts(t.CloudStorageMountsJSON)
	return mounts
}

func (t *TrainingTask) SelectedCodeRepositoryMounts() []TrainingTaskCodeRepositoryMount {
	if t == nil {
		return nil
	}
	if len(t.CodeRepositoryMounts) > 0 {
		return t.CodeRepositoryMounts
	}
	mounts, _ := DecodeTrainingTaskCodeRepositoryMounts(t.CodeRepositoryMountsJSON)
	return mounts
}

func (t *TrainingTask) SelectedDatasets() []RuntimeDataset {
	if t == nil {
		return nil
	}
	if len(t.Datasets) > 0 {
		return t.Datasets
	}
	datasets, _ := DecodeRuntimeDatasets(t.DatasetsJSON)
	return datasets
}

func (t *TrainingTask) SelectedDatasetMounts() []DatasetMount {
	if t == nil {
		return nil
	}
	if len(t.DatasetMounts) > 0 {
		return t.DatasetMounts
	}
	mounts, _ := DecodeDatasetMounts(t.DatasetMountsJSON)
	return mounts
}

func DecodeTrainingTaskCloudStorageMounts(value string) ([]TrainingTaskCloudStorageMount, error) {
	if value == "" {
		return nil, nil
	}
	var mounts []TrainingTaskCloudStorageMount
	if err := json.Unmarshal([]byte(value), &mounts); err != nil {
		return nil, err
	}
	return mounts, nil
}

func DecodeTrainingTaskCodeRepositoryMounts(value string) ([]TrainingTaskCodeRepositoryMount, error) {
	if value == "" {
		return nil, nil
	}
	var mounts []TrainingTaskCodeRepositoryMount
	if err := json.Unmarshal([]byte(value), &mounts); err != nil {
		return nil, err
	}
	return mounts, nil
}

func EncodeTrainingTaskCloudStorageMounts(mounts []TrainingTaskCloudStorageMount) (string, error) {
	if len(mounts) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(mounts)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func EncodeTrainingTaskCodeRepositoryMounts(mounts []TrainingTaskCodeRepositoryMount) (string, error) {
	if len(mounts) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(mounts)
	if err != nil {
		return "", err
	}
	return string(data), nil
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
