package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestBuildDevelopmentInstanceSpecDefaultsSSHUserToFlytekit(t *testing.T) {
	spec, err := BuildDevelopmentInstanceSpec(&models.DevelopmentInstance{
		DevelopmentInstanceKey: models.DevelopmentInstanceKey{ID: "ins-default-user"},
		Org:                    "testorg",
		Project:                "flytesnacks",
		Domain:                 "development",
		Name:                   "默认用户实例",
		ImageURI:               "docker.fzyun.io/founder/aione.ide:1.0.0.60",
		CPU:                    "2",
		Memory:                 "4Gi",
		MaxHours:               24,
	})

	require.NoError(t, err)
	custom := spec.GetTaskTemplate().GetCustom().GetFields()
	require.Equal(t, "flytekit", custom["sshUser"].GetStringValue())
	require.Nil(t, custom["workspaceSize"])
	require.Nil(t, custom["workspacePVCName"])
}
