package trainingtask

import (
	"fmt"
	"strings"

	aionecoderepository "github.com/flyteorg/flyte/v2/flyteplugins/aione/coderepository"
	idlcore "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
	"github.com/flyteorg/flyte/v2/runs/aione/datasetsecret"
	"google.golang.org/protobuf/types/known/structpb"
)

const TaskType = "training_task"

type TrainingConfig struct {
	Image              string
	Command            string
	DownloaderImage    string
	CPU                string
	Memory             string
	GPUCount           int32
	GPUModel           string
	Bandwidth          string
	MaxRuntimeHours    int32
	CloudStorageMounts []CloudStorageMount
	CodeRepositories   []CodeRepositoryMount
	Datasets           []RuntimeDataset
}

type CloudStorageMount struct {
	ID           string
	PVCName      string
	StorageClass string
	Size         string
	MountPath    string
}

type CodeRepositoryMount = aionecoderepository.Mount

type RuntimeDataset struct {
	Endpoint            string
	Port                string
	AccessKey           string
	SecretKey           string
	SecretKeyCiphertext string
	TargetPath          string
	Bucket              string
	BucketPath          string
}

func ParseConfig(taskTemplate *idlcore.TaskTemplate) (TrainingConfig, error) {
	if taskTemplate == nil {
		return TrainingConfig{}, fmt.Errorf("task template is required")
	}
	custom := taskTemplate.GetCustom()
	if custom == nil {
		return TrainingConfig{}, fmt.Errorf("custom payload is required for %s", TaskType)
	}

	values := custom.AsMap()
	cfg := TrainingConfig{
		Image:           stringValue(values, "image", ""),
		Command:         stringValue(values, "command", ""),
		CPU:             stringValue(values, "cpu", ""),
		Memory:          stringValue(values, "memory", ""),
		GPUModel:        stringValue(values, "gpuModel", ""),
		Bandwidth:       stringValue(values, "bandwidth", ""),
		DownloaderImage: stringValue(values, "downloaderImage", ""),
		MaxRuntimeHours: 1,
	}
	if cfg.Image == "" {
		return TrainingConfig{}, fmt.Errorf("image is required")
	}
	if cfg.Command == "" {
		return TrainingConfig{}, fmt.Errorf("command is required")
	}
	if gpuCount, ok, err := int32Value(values, "gpuCount"); err != nil {
		return TrainingConfig{}, err
	} else if ok {
		if gpuCount < 0 {
			return TrainingConfig{}, fmt.Errorf("gpuCount must be non-negative")
		}
		cfg.GPUCount = gpuCount
	}
	if maxRuntimeHours, ok, err := int32Value(values, "maxRuntimeHours"); err != nil {
		return TrainingConfig{}, err
	} else if ok {
		if maxRuntimeHours <= 0 {
			return TrainingConfig{}, fmt.Errorf("maxRuntimeHours must be positive")
		}
		cfg.MaxRuntimeHours = maxRuntimeHours
	}
	mounts, err := cloudStorageMountsValue(custom)
	if err != nil {
		return TrainingConfig{}, err
	}
	cfg.CloudStorageMounts = mounts
	codeRepositories, err := aionecoderepository.ParseMounts(custom)
	if err != nil {
		return TrainingConfig{}, err
	}
	cfg.CodeRepositories = codeRepositories
	datasets, err := datasetsValue(custom)
	if err != nil {
		return TrainingConfig{}, err
	}
	cfg.Datasets = datasets

	return cfg, nil
}

func stringValue(values map[string]any, key, fallback string) string {
	if raw, ok := values[key]; ok {
		return strings.TrimSpace(fmt.Sprint(raw))
	}
	return fallback
}

func int32Value(values map[string]any, key string) (int32, bool, error) {
	raw, ok := values[key]
	if !ok {
		return 0, false, nil
	}
	switch v := raw.(type) {
	case float64:
		return int32(v), true, nil
	case int:
		return int32(v), true, nil
	case int32:
		return v, true, nil
	default:
		return 0, false, fmt.Errorf("%s must be an integer", key)
	}
}

func cloudStorageMountsValue(custom *structpb.Struct) ([]CloudStorageMount, error) {
	raw := custom.GetFields()["cloudStorageMounts"]
	if raw == nil {
		return nil, nil
	}
	list := raw.GetListValue()
	if list == nil {
		return nil, fmt.Errorf("cloudStorageMounts must be an array")
	}
	mounts := make([]CloudStorageMount, 0, len(list.Values))
	for _, item := range list.Values {
		fields := item.GetStructValue().GetFields()
		mount := CloudStorageMount{
			ID:           strings.TrimSpace(fields["id"].GetStringValue()),
			PVCName:      strings.TrimSpace(fields["pvcName"].GetStringValue()),
			StorageClass: strings.TrimSpace(fields["storageClass"].GetStringValue()),
			Size:         strings.TrimSpace(fields["size"].GetStringValue()),
			MountPath:    strings.TrimSpace(fields["mountPath"].GetStringValue()),
		}
		if mount.ID == "" || mount.PVCName == "" || mount.StorageClass == "" || mount.Size == "" || mount.MountPath == "" {
			return nil, fmt.Errorf("cloudStorageMounts entries require id, pvcName, storageClass, size, and mountPath")
		}
		mounts = append(mounts, mount)
	}
	return mounts, nil
}

func datasetsValue(custom *structpb.Struct) ([]RuntimeDataset, error) {
	raw := custom.GetFields()["datasets"]
	if raw == nil {
		return nil, nil
	}
	list := raw.GetListValue()
	if list == nil {
		return nil, fmt.Errorf("datasets must be an array")
	}
	datasets := make([]RuntimeDataset, 0, len(list.Values))
	for _, item := range list.Values {
		fields := item.GetStructValue().GetFields()
		dataset := RuntimeDataset{
			Endpoint:            strings.TrimSpace(fields["endpoint"].GetStringValue()),
			Port:                strings.TrimSpace(valueToString(fields["port"])),
			AccessKey:           strings.TrimSpace(fields["accessKey"].GetStringValue()),
			SecretKey:           strings.TrimSpace(fields["secretKey"].GetStringValue()),
			SecretKeyCiphertext: strings.TrimSpace(fields["secretKeyCiphertext"].GetStringValue()),
			TargetPath:          strings.TrimSpace(fields["targetPath"].GetStringValue()),
			Bucket:              strings.TrimSpace(fields["bucket"].GetStringValue()),
			BucketPath:          strings.TrimSpace(fields["bucketPath"].GetStringValue()),
		}
		if dataset.SecretKey == "" && dataset.SecretKeyCiphertext != "" {
			secretKey, err := datasetsecret.Decrypt(dataset.SecretKeyCiphertext)
			if err != nil {
				return nil, err
			}
			dataset.SecretKey = secretKey
		}
		if dataset.Endpoint == "" || dataset.Port == "" || dataset.AccessKey == "" || dataset.SecretKey == "" || dataset.TargetPath == "" || dataset.Bucket == "" {
			return nil, fmt.Errorf("datasets entries require endpoint, port, accessKey, secretKey, targetPath, and bucket")
		}
		datasets = append(datasets, dataset)
	}
	return datasets, nil
}

func valueToString(value *structpb.Value) string {
	if value == nil {
		return ""
	}
	if s := value.GetStringValue(); s != "" {
		return s
	}
	if n := value.GetNumberValue(); n != 0 {
		return fmt.Sprintf("%.0f", n)
	}
	return ""
}
