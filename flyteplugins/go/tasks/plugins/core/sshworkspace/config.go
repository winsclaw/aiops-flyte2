package sshworkspace

import (
	"fmt"
	"strings"

	"google.golang.org/protobuf/types/known/structpb"
	corev1 "k8s.io/api/core/v1"

	idlcore "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

const TaskType = "ssh_workspace"

type WorkspaceConfig struct {
	Image          string
	SSHUser        string
	AuthorizedKeys []string
	CPU            string
	Memory         string
	WorkspaceSize  string
	ServiceType    corev1.ServiceType
	NodePort       *int32
	Environment    map[string]string
}

func ParseConfig(taskTemplate *idlcore.TaskTemplate) (WorkspaceConfig, error) {
	if taskTemplate == nil {
		return WorkspaceConfig{}, fmt.Errorf("task template is required")
	}
	custom := taskTemplate.GetCustom()
	if custom == nil {
		return WorkspaceConfig{}, fmt.Errorf("custom payload is required for %s", TaskType)
	}

	values := custom.AsMap()
	cfg := WorkspaceConfig{
		Image:         stringValue(values, "image", "ubuntu:22.04"),
		SSHUser:       stringValue(values, "sshUser", "dev"),
		CPU:           stringValue(values, "cpu", ""),
		Memory:        stringValue(values, "memory", ""),
		WorkspaceSize: stringValue(values, "workspaceSize", ""),
		ServiceType:   corev1.ServiceTypeClusterIP,
		Environment:   map[string]string{},
	}

	if serviceType := stringValue(values, "serviceType", "ClusterIP"); serviceType != "" {
		switch corev1.ServiceType(serviceType) {
		case corev1.ServiceTypeClusterIP, corev1.ServiceTypeNodePort, corev1.ServiceTypeLoadBalancer:
			cfg.ServiceType = corev1.ServiceType(serviceType)
		default:
			return WorkspaceConfig{}, fmt.Errorf("serviceType must be ClusterIP, NodePort, or LoadBalancer")
		}
	}

	authorizedKeys, err := stringSliceValue(custom, "authorizedKeys")
	if err != nil {
		return WorkspaceConfig{}, err
	}
	cfg.AuthorizedKeys = authorizedKeys
	if len(cfg.AuthorizedKeys) == 0 {
		return WorkspaceConfig{}, fmt.Errorf("authorizedKeys must include at least one SSH public key")
	}

	if cfg.Image == "" {
		return WorkspaceConfig{}, fmt.Errorf("image is required")
	}
	if cfg.SSHUser == "" {
		return WorkspaceConfig{}, fmt.Errorf("sshUser is required")
	}

	if nodePort, ok, err := int32Value(values, "nodePort"); err != nil {
		return WorkspaceConfig{}, err
	} else if ok {
		if nodePort < 30000 || nodePort > 32767 {
			return WorkspaceConfig{}, fmt.Errorf("nodePort must be between 30000 and 32767")
		}
		cfg.NodePort = &nodePort
	}

	if cfg.NodePort != nil && cfg.ServiceType != corev1.ServiceTypeNodePort {
		return WorkspaceConfig{}, fmt.Errorf("nodePort is only valid when serviceType is NodePort")
	}

	if env, ok := values["environment"].(map[string]any); ok {
		for k, v := range env {
			cfg.Environment[k] = fmt.Sprint(v)
		}
	}

	return cfg, nil
}

func stringValue(values map[string]any, key, fallback string) string {
	if raw, ok := values[key]; ok {
		return strings.TrimSpace(fmt.Sprint(raw))
	}
	return fallback
}

func stringSliceValue(custom *structpb.Struct, key string) ([]string, error) {
	raw := custom.GetFields()[key]
	if raw == nil {
		return nil, nil
	}
	list := raw.GetListValue()
	if list == nil {
		return nil, fmt.Errorf("%s must be a string array", key)
	}
	result := make([]string, 0, len(list.Values))
	for _, item := range list.Values {
		value := strings.TrimSpace(item.GetStringValue())
		if value == "" {
			return nil, fmt.Errorf("%s must not contain empty values", key)
		}
		result = append(result, value)
	}
	return result, nil
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
