package trainingtask

import (
	"fmt"
	"strings"

	idlcore "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

const TaskType = "training_task"

type TrainingConfig struct {
	Image           string
	Command         string
	CPU             string
	Memory          string
	GPUCount        int32
	GPUModel        string
	Bandwidth       string
	MaxRuntimeHours int32
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
