package service

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	"github.com/flyteorg/flyte/v2/dataproxy/logs"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/dataproxy"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/workflow"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/workflow/workflowconnect"
)

type RunLogsService struct {
	runClient   workflowconnect.RunServiceClient
	logStreamer logs.LogStreamer
}

func NewRunLogsService(runClient workflowconnect.RunServiceClient, logStreamer logs.LogStreamer) *RunLogsService {
	return &RunLogsService{runClient: runClient, logStreamer: logStreamer}
}

func (s *RunLogsService) TailLogs(
	ctx context.Context,
	req *connect.Request[workflow.TailLogsRequest],
	stream *connect.ServerStream[workflow.TailLogsResponse],
) error {
	if s.logStreamer == nil {
		return connect.NewError(connect.CodeUnimplemented, fmt.Errorf("log streaming is not configured"))
	}
	logCtxResp, err := s.runClient.GetActionLogContext(ctx, connect.NewRequest(&workflow.GetActionLogContextRequest{
		ActionId: req.Msg.GetActionId(),
		Attempt:  req.Msg.GetAttempt(),
	}))
	if err != nil {
		return err
	}

	logContext := logCtxResp.Msg.GetLogContext()
	if logContext == nil {
		return connect.NewError(connect.CodeNotFound, fmt.Errorf("no log context found"))
	}

	return s.logStreamer.TailLogs(ctx, logContext, workflowLogStream{stream: stream})
}

type workflowLogStream struct {
	stream *connect.ServerStream[workflow.TailLogsResponse]
}

func (s workflowLogStream) Send(resp *dataproxy.TailLogsResponse) error {
	logs := make([]*workflow.TailLogsResponse_Logs, 0, len(resp.GetLogs()))
	for _, batch := range resp.GetLogs() {
		logs = append(logs, &workflow.TailLogsResponse_Logs{Lines: batch.GetLines()})
	}
	return s.stream.Send(&workflow.TailLogsResponse{Logs: logs})
}
