package models

import (
	"encoding/json"
	"time"
)

const (
	DevelopmentInstanceStatusNotStarted = "NOT_STARTED"
	DevelopmentInstanceStatusStarting   = "STARTING"
	DevelopmentInstanceStatusRunning    = "RUNNING"
	DevelopmentInstanceStatusStopping   = "STOPPING"
	DevelopmentInstanceStatusStopped    = "STOPPED"
	DevelopmentInstanceStatusSucceeded  = "SUCCEEDED"
	DevelopmentInstanceStatusFailed     = "FAILED"
	DevelopmentInstanceStatusTimedOut   = "TIMED_OUT"
)

type DevelopmentInstanceKey struct {
	ID string `db:"id"`
}

type DevelopmentInstance struct {
	DevelopmentInstanceKey

	Org                      string                             `db:"org"`
	Project                  string                             `db:"project"`
	Domain                   string                             `db:"domain"`
	Name                     string                             `db:"name"`
	Description              string                             `db:"description"`
	Owner                    string                             `db:"owner"`
	SourceSystem             string                             `db:"source_system"`
	ResourceDisplay          string                             `db:"resource_display"`
	CPU                      string                             `db:"cpu"`
	Memory                   string                             `db:"memory"`
	GPUCount                 uint32                             `db:"gpu_count"`
	GPUModel                 string                             `db:"gpu_model"`
	Bandwidth                string                             `db:"bandwidth"`
	WorkspaceSize            string                             `db:"workspace_size"`
	MaxHours                 uint32                             `db:"max_hours"`
	ImageType                string                             `db:"image_type"`
	OfficialImageID          string                             `db:"official_image_id"`
	ImageName                string                             `db:"image_name"`
	ImageURI                 string                             `db:"image_uri"`
	ImagePullSecretName      string                             `db:"image_pull_secret_name"`
	CodeRepositorySecretName string                             `db:"code_repository_secret_name"`
	GPUNodeLabelKey          string                             `db:"gpu_node_label_key"`
	BaseImageMountPath       string                             `db:"base_image_mount_path"`
	SSHUser                  string                             `db:"ssh_user"`
	AuthorizedKeysJSON       string                             `db:"authorized_keys_json"`
	WorkspacePVCName         string                             `db:"workspace_pvc_name"`
	LatestRunName            string                             `db:"latest_run_name"`
	Status                   string                             `db:"status"`
	Generation               uint32                             `db:"generation"`
	NodePort                 uint32                             `db:"node_port"`
	CodeServerNodePort       uint32                             `db:"code_server_node_port"`
	CodeServerURL            string                             `db:"code_server_url"`
	CodeServerWorkspaceURL   string                             `db:"code_server_workspace_url"`
	CloudStorageMountsJSON   string                             `db:"cloud_storage_mounts_json"`
	CodeRepositoryMountsJSON string                             `db:"code_repository_mounts_json"`
	CloudStorageMounts       []DevelopmentInstanceCloudMount    `db:"-"`
	CodeRepositoryMounts     []DevelopmentInstanceCodeRepoMount `db:"-"`
	DeletedAt                *time.Time                         `db:"deleted_at"`
	CreatedAt                time.Time                          `db:"created_at"`
	UpdatedAt                time.Time                          `db:"updated_at"`
}

type DevelopmentInstanceCloudMount struct {
	CloudStorageID   string `json:"cloudStorageId"`
	PVCName          string `json:"pvcName,omitempty"`
	StorageClassName string `json:"storageClassName,omitempty"`
	Size             string `json:"size,omitempty"`
	MountPath        string `json:"mountPath"`
}

type DevelopmentInstanceCodeRepoMount struct {
	CodeRepositoryID string `json:"codeRepositoryId"`
	RepoURL          string `json:"repoUrl,omitempty"`
	Branch           string `json:"branch,omitempty"`
	MountPath        string `json:"mountPath"`
	Token            string `json:"token,omitempty"`
}

func (i *DevelopmentInstance) SelectedCloudStorageMounts() []DevelopmentInstanceCloudMount {
	if i == nil {
		return nil
	}
	if len(i.CloudStorageMounts) > 0 {
		return i.CloudStorageMounts
	}
	mounts, _ := DecodeDevelopmentInstanceCloudMounts(i.CloudStorageMountsJSON)
	return mounts
}

func (i *DevelopmentInstance) SelectedCodeRepositoryMounts() []DevelopmentInstanceCodeRepoMount {
	if i == nil {
		return nil
	}
	if len(i.CodeRepositoryMounts) > 0 {
		return i.CodeRepositoryMounts
	}
	mounts, _ := DecodeDevelopmentInstanceCodeRepoMounts(i.CodeRepositoryMountsJSON)
	return mounts
}

func DecodeDevelopmentInstanceCloudMounts(value string) ([]DevelopmentInstanceCloudMount, error) {
	if value == "" {
		return nil, nil
	}
	var mounts []DevelopmentInstanceCloudMount
	if err := json.Unmarshal([]byte(value), &mounts); err != nil {
		return nil, err
	}
	return mounts, nil
}

func DecodeDevelopmentInstanceCodeRepoMounts(value string) ([]DevelopmentInstanceCodeRepoMount, error) {
	if value == "" {
		return nil, nil
	}
	var mounts []DevelopmentInstanceCodeRepoMount
	if err := json.Unmarshal([]byte(value), &mounts); err != nil {
		return nil, err
	}
	return mounts, nil
}

func EncodeDevelopmentInstanceCloudMounts(mounts []DevelopmentInstanceCloudMount) (string, error) {
	if len(mounts) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(mounts)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func EncodeDevelopmentInstanceCodeRepoMounts(mounts []DevelopmentInstanceCodeRepoMount) (string, error) {
	if len(mounts) == 0 {
		return "[]", nil
	}
	data, err := json.Marshal(mounts)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

type DevelopmentInstanceListInput struct {
	Org     string
	Project string
	Domain  string
	Search  string
	Limit   uint32
	Offset  uint32
}

type DevelopmentInstanceListResult struct {
	Items []*DevelopmentInstance
	Total uint32
}

type DevelopmentInstanceRun struct {
	ID                 uint64     `db:"id"`
	InstanceID         string     `db:"instance_id"`
	Org                string     `db:"org"`
	Project            string     `db:"project"`
	Domain             string     `db:"domain"`
	RunName            string     `db:"run_name"`
	Generation         uint32     `db:"generation"`
	Status             string     `db:"status"`
	NodePort           uint32     `db:"node_port"`
	CodeServerNodePort uint32     `db:"code_server_node_port"`
	StartedAt          *time.Time `db:"started_at"`
	EndedAt            *time.Time `db:"ended_at"`
	CreatedAt          time.Time  `db:"created_at"`
	UpdatedAt          time.Time  `db:"updated_at"`
}

type DevelopmentInstanceRunListInput struct {
	InstanceID string
	Limit      uint32
	Offset     uint32
}

type DevelopmentInstanceRunListResult struct {
	Items []*DevelopmentInstanceRun
	Total uint32
}
