package k8s

import (
	"context"
	"testing"

	"github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core/mocks"
	"github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/ioutils"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShouldReadTaskOutputs(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name             string
		template         *core.TaskTemplate
		bufferedOutput   bool
		expectedDecision bool
	}{
		{
			name:             "no interface",
			template:         &core.TaskTemplate{},
			expectedDecision: false,
		},
		{
			name: "empty outputs",
			template: &core.TaskTemplate{
				Interface: &core.TypedInterface{
					Outputs: &core.VariableMap{},
				},
			},
			expectedDecision: false,
		},
		{
			name: "declared outputs",
			template: &core.TaskTemplate{
				Interface: &core.TypedInterface{
					Outputs: &core.VariableMap{
						Variables: []*core.VariableEntry{{Key: "result", Value: &core.Variable{}}},
					},
				},
			},
			expectedDecision: true,
		},
		{
			name:             "buffered plugin output",
			bufferedOutput:   true,
			expectedDecision: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tCtx := mocks.NewTaskExecutionContext(t)
			pCtx := &pluginContext{}

			if tt.bufferedOutput {
				pCtx.ow = &ioutils.BufferedOutputWriter{}
			} else {
				taskReader := mocks.NewTaskReader(t)
				tCtx.EXPECT().TaskReader().Return(taskReader)
				taskReader.EXPECT().Read(ctx).Return(tt.template, nil)
			}

			shouldRead, err := shouldReadTaskOutputs(ctx, tCtx, pCtx)
			require.NoError(t, err)
			assert.Equal(t, tt.expectedDecision, shouldRead)
		})
	}
}
