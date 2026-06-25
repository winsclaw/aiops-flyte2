import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ImageType,
  ResourceSpecSchema,
  TrainingTaskIdentifierSchema,
  TrainingTaskSchema,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import { create } from "@bufbuild/protobuf";
import { StatusPill, TrainingTasksListPage } from "./ListPage";

const mocks = vi.hoisted(() => ({
  deleteTrainingTask: vi.fn(),
  listTrainingTasks: vi.fn(),
  push: vi.fn(),
  startTrainingTask: vi.fn(),
  stopTrainingTask: vi.fn(),
}));

vi.mock("@/components/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/useConnectRpc", () => ({
  useConnectRpcClient: () => ({
    deleteTrainingTask: mocks.deleteTrainingTask,
    listTrainingTasks: mocks.listTrainingTasks,
    startTrainingTask: mocks.startTrainingTask,
    stopTrainingTask: mocks.stopTrainingTask,
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "testorg",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ domain: "development", project: "flytesnacks" }),
  useRouter: () => ({
    push: mocks.push,
  }),
}));

describe("TrainingTasksListPage", () => {
  beforeEach(() => {
    mocks.deleteTrainingTask.mockReset();
    mocks.listTrainingTasks.mockReset();
    mocks.push.mockReset();
    mocks.startTrainingTask.mockReset();
    mocks.stopTrainingTask.mockReset();
  });

  it("renders display name and run ID without description or runtime duration columns", async () => {
    const taskId = "tsk-internal-1";
    const runId = "logs-smoke-180036";
    mocks.listTrainingTasks.mockResolvedValue({
      trainingTasks: [
        create(TrainingTaskSchema, {
          id: create(TrainingTaskIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            id: taskId,
          }),
          name: "logs-test",
          description: "external-system/logs-smoke-180036",
          latestRunName: runId,
          resourceSpec: create(ResourceSpecSchema, {
            displayLabel: "1vCPU, 128MiB RAM",
          }),
          status: TrainingTaskStatus.RUNNING,
          runtimeDuration: "12m",
          creator: "external-system",
          imageType: ImageType.CUSTOM,
          imageUri: "rancher/mirrored-library-busybox:1.37.0",
        }),
      ],
    });

    render(<TrainingTasksListPage />);

    expect(screen.getByRole("columnheader", { name: "名称" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "运行 ID" })).toBeVisible();
    expect(
      screen.queryByRole("columnheader", { name: "描述" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "运行时长" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("logs-test")).toBeVisible();
    expect(screen.getByText(runId)).toBeVisible();
    expect(screen.queryByText(taskId)).not.toBeInTheDocument();
    expect(
      screen.queryByText("external-system/logs-smoke-180036"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("12m")).not.toBeInTheDocument();
  });
});

describe("TrainingTasksListPage status", () => {
  it("shows a short failure reason next to failed tasks", () => {
    const fullMessage =
      '镜像拉取失败: rpc error: code = NotFound desc = failed to pull and unpack image "docker.fzyun.io/library/codex-image-does-not-exist:missing"';

    render(
      <StatusPill
        status={TrainingTaskStatus.FAILED}
        statusMessage={fullMessage}
      />,
    );

    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("镜像拉取失败")).toBeInTheDocument();
    expect(screen.queryByText(fullMessage)).not.toBeInTheDocument();
  });
});
