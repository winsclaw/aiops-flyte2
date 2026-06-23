package coderepository

import (
	"context"

	"connectrpc.com/connect"

	"github.com/flyteorg/flyte/v2/flytestdlib/app"
	"github.com/flyteorg/flyte/v2/flytestdlib/logger"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository/coderepositoryconnect"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
)

func Setup(ctx context.Context, sc *app.SetupContext, repo interfaces.CodeRepositoryRepo, interceptor connect.Interceptor) {
	svc := NewService(repo)
	path, handler := coderepositoryconnect.NewCodeRepositoryServiceHandler(svc, connect.WithInterceptors(interceptor))
	sc.Mux.Handle(path, handler)
	logger.Infof(ctx, "Mounted Aione CodeRepositoryService at %s", path)
}
