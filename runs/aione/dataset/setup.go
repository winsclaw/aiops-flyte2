package dataset

import (
	"context"

	"connectrpc.com/connect"

	"github.com/flyteorg/flyte/v2/flytestdlib/app"
	"github.com/flyteorg/flyte/v2/flytestdlib/logger"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/dataset/datasetconnect"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
)

func Setup(ctx context.Context, sc *app.SetupContext, datasetRepo interfaces.DatasetRepo, interceptor connect.Interceptor) {
	svc := NewService(datasetRepo)
	path, handler := datasetconnect.NewDatasetServiceHandler(svc, connect.WithInterceptors(interceptor))
	sc.Mux.Handle(path, handler)
	logger.Infof(ctx, "Mounted Aione DatasetService at %s", path)
}
