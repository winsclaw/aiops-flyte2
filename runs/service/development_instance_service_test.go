package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/common"
	developmentinstancepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/developmentinstance"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestBuildDevelopmentInstanceModelUsesExplicitID(t *testing.T) {
	model, err := buildDevelopmentInstanceModel(
		&common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		&developmentinstancepb.DevelopmentInstanceInput{
			Name:          "开发实例",
			Owner:         "external-api",
			ImageType:     developmentinstancepb.ImageType_IMAGE_TYPE_CUSTOM,
			ImageName:     "custom-ide",
			ImageUri:      "docker.fzyun.io/founder/aione.ide:1.0.0.60",
			SshUser:       "dev",
			Cpu:           "2",
			Memory:        "4Gi",
			WorkspaceSize: "20Gi",
			MaxHours:      24,
			SourceSystem:  "aione",
		},
		"external-api",
		"external-instance-1",
	)

	require.NoError(t, err)
	require.Equal(t, "external-instance-1", model.ID)
	require.Equal(t, "开发实例", model.Name)
	require.Equal(t, "external-api", model.Owner)
	require.Equal(t, "2vCPU, 4GiB RAM, 20Gi 工作区", model.ResourceDisplay)
	require.Equal(t, "2", model.CPU)
	require.Equal(t, "4Gi", model.Memory)
	require.Equal(t, "20Gi", model.WorkspaceSize)
	require.Equal(t, models.DevelopmentInstanceStatusNotStarted, model.Status)
}

func TestBuildDevelopmentInstanceSpecUsesSSHWorkspacePluginAndDisplayShortName(t *testing.T) {
	spec, err := BuildDevelopmentInstanceSpec(&models.DevelopmentInstance{
		DevelopmentInstanceKey: models.DevelopmentInstanceKey{ID: "ins-abc"},
		Org:                    "testorg",
		Project:                "flytesnacks",
		Domain:                 "development",
		Name:                   "开发实例-带云存储",
		ImageURI:               "docker.fzyun.io/founder/aione.ide:1.0.0.60",
		SSHUser:                "dev",
		CPU:                    "2",
		Memory:                 "4Gi",
		WorkspaceSize:          "20Gi",
		MaxHours:               24,
		WorkspacePVCName:       "ins-abc-workspace",
		NodePort:               31000,
		CodeServerNodePort:     31001,
	})

	require.NoError(t, err)
	require.Equal(t, developmentInstanceTaskType, spec.GetTaskTemplate().GetType())
	require.Equal(t, developmentInstanceTaskType, spec.GetTaskTemplate().GetId().GetName())
	require.Equal(t, "开发实例-带云存储", spec.GetShortName())
	custom := spec.GetTaskTemplate().GetCustom().GetFields()
	require.Equal(t, "ins-abc", custom["sourceInstanceId"].GetStringValue())
	require.Equal(t, "开发实例-带云存储", custom["sourceName"].GetStringValue())
	require.Equal(t, "docker.fzyun.io/founder/aione.ide:1.0.0.60", custom["image"].GetStringValue())
	require.Equal(t, float64(31000), custom["nodePort"].GetNumberValue())
	require.Equal(t, float64(31001), custom["codeServerNodePort"].GetNumberValue())
}

func TestBuildDevelopmentInstanceSpecLetsPluginOwnCodeRepositorySecret(t *testing.T) {
	spec, err := BuildDevelopmentInstanceSpec(&models.DevelopmentInstance{
		DevelopmentInstanceKey:   models.DevelopmentInstanceKey{ID: "aione-instance"},
		Org:                      "aione",
		Project:                  "aione",
		Domain:                   "development",
		Name:                     "开发实例一",
		ImageURI:                 "docker.fzyun.io/founder/aione.ide:1.0.0.60",
		SSHUser:                  "dev",
		CPU:                      "2",
		Memory:                   "4Gi",
		WorkspaceSize:            "20Gi",
		MaxHours:                 1,
		WorkspacePVCName:         "aione-instance-workspace",
		NodePort:                 31000,
		CodeServerNodePort:       31001,
		CodeRepositorySecretName: "aione-aione-instance-code",
		CodeRepositoryMounts: []models.DevelopmentInstanceCodeRepoMount{{
			CodeRepositoryID: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
			RepoURL:          "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
			Branch:           "master",
			MountPath:        "/data/js-sample",
		}},
	})

	require.NoError(t, err)
	custom := spec.GetTaskTemplate().GetCustom().GetFields()
	require.Equal(t, "", custom["codeRepositorySecretName"].GetStringValue())
	require.Len(t, custom["codeRepositories"].GetListValue().GetValues(), 1)
}

func TestBuildDevelopmentInstanceRunNameUsesStableInstanceIDAndGeneration(t *testing.T) {
	require.Equal(t, "external-instance-1-r2", buildDevelopmentInstanceRunName("external-instance-1", 2))
	require.Equal(t, "very-long-instanc-8c22f452-r12", buildDevelopmentInstanceRunName("very-long-instance-id-that-needs-truncation", 12))
}

func TestNextDevelopmentInstanceRunNameSkipsExistingFlyteRuns(t *testing.T) {
	generation, runName, err := nextDevelopmentInstanceRunName(0, "aione-instance", func(_ uint32, candidate string) (bool, error) {
		return candidate == "aione-instance-r1", nil
	})

	require.NoError(t, err)
	require.Equal(t, uint32(2), generation)
	require.Equal(t, "aione-instance-r2", runName)
}

func TestApplyDevelopmentInstanceRunAccessReplacesPreviousRunURL(t *testing.T) {
	instance := &models.DevelopmentInstance{
		CodeServerURL:          "https://aione-instance-r3-code.ops.fzyun.io",
		CodeServerWorkspaceURL: "https://aione-instance-r3-code.ops.fzyun.io/?folder=/workspace",
	}

	applyDevelopmentInstanceRunAccess(instance, "aione-instance-r4")

	require.Equal(t, "https://aione-instance-r4-code.ops.fzyun.io", instance.CodeServerURL)
	require.Equal(t, "https://aione-instance-r4-code.ops.fzyun.io/?folder=/workspace", instance.CodeServerWorkspaceURL)
}
