package service

import (
	"fmt"

	trainingtaskpb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/trainingtask"
)

const (
	trainingTaskType = "training_task"
)

var trainingTaskResourceSpecs = []*trainingtaskpb.ResourceSpec{
	{Id: "rtx5090-8c-64g-1x", DisplayLabel: "8vCPU, 64GiB RAM, 1*NVIDIA RTX 5090, 1Gbps", Cpu: "8", Memory: "64Gi", GpuCount: 1, GpuModel: "NVIDIA RTX 5090", Bandwidth: "1Gbps"},
	{Id: "rtx5090-16c-128g-2x", DisplayLabel: "16vCPU, 128GiB RAM, 2*NVIDIA RTX 5090, 1Gbps", Cpu: "16", Memory: "128Gi", GpuCount: 2, GpuModel: "NVIDIA RTX 5090", Bandwidth: "1Gbps"},
	{Id: "rtx5090-32c-256g-4x", DisplayLabel: "32vCPU, 256GiB RAM, 4*NVIDIA RTX 5090, 1Gbps", Cpu: "32", Memory: "256Gi", GpuCount: 4, GpuModel: "NVIDIA RTX 5090", Bandwidth: "1Gbps"},
	{Id: "rtx3090-4c-32g-1x", DisplayLabel: "4vCPU, 32GiB RAM, 1*NVIDIA RTX 3090, 1Gbps", Cpu: "4", Memory: "32Gi", GpuCount: 1, GpuModel: "NVIDIA RTX 3090", Bandwidth: "1Gbps"},
	{Id: "rtx3090-8c-48g-1x", DisplayLabel: "8vCPU, 48GiB RAM, 1*NVIDIA RTX 3090, 1Gbps", Cpu: "8", Memory: "48Gi", GpuCount: 1, GpuModel: "NVIDIA RTX 3090", Bandwidth: "1Gbps"},
	{Id: "rtx3090-8c-64g-2x", DisplayLabel: "8vCPU, 64GiB RAM, 2*NVIDIA RTX 3090, 1Gbps", Cpu: "8", Memory: "64Gi", GpuCount: 2, GpuModel: "NVIDIA RTX 3090", Bandwidth: "1Gbps"},
	{Id: "t4-8c-16g-1x", DisplayLabel: "8vCPU, 16GiB RAM, 1*NVIDIA T4, 1Gbps", Cpu: "8", Memory: "16Gi", GpuCount: 1, GpuModel: "NVIDIA T4", Bandwidth: "1Gbps"},
}

var trainingTaskOfficialImages = []*trainingtaskpb.OfficialImage{
	{Id: "busybox", Name: "BusyBox 1.36", ImageUri: "busybox:1.36"},
}

func trainingTaskResourceSpecByID(id string) (*trainingtaskpb.ResourceSpec, error) {
	for _, spec := range trainingTaskResourceSpecs {
		if spec.GetId() == id {
			return spec, nil
		}
	}
	return nil, fmt.Errorf("unknown resource spec %q", id)
}

func trainingTaskOfficialImageByID(id string) (*trainingtaskpb.OfficialImage, error) {
	for _, image := range trainingTaskOfficialImages {
		if image.GetId() == id {
			return image, nil
		}
	}
	return nil, fmt.Errorf("unknown official image %q", id)
}
