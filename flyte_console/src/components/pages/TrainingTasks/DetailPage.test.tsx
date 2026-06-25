import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  TrainingTaskSchema,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import { TrainingTaskDetailPage } from "./DetailPage";

const getTrainingTask = vi.fn();
const push = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    domain: "development",
    project: "flytesnacks",
    taskId: "train-task",
  }),
  useRouter: () => ({ push }),
}));

vi.mock("@/components/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/useConnectRpc", () => ({
  useConnectRpcClient: () => ({
    getTrainingTask,
    startTrainingTask: vi.fn(),
    stopTrainingTask: vi.fn(),
    deleteTrainingTask: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "aione",
}));

describe("TrainingTaskDetailPage", () => {
  it("shows the latest run link as run info in the top action area", async () => {
    getTrainingTask.mockResolvedValue({
      trainingTask: create(TrainingTaskSchema, {
        name: "训练任务一",
        latestRunName: "abc123",
        status: TrainingTaskStatus.RUNNING,
      }),
    });

    render(<TrainingTaskDetailPage />);

    const actions = await screen.findByLabelText("训练任务操作");
    await waitFor(() => {
      expect(getTrainingTask).toHaveBeenCalled();
    });

    const runInfoLink = within(actions).getByRole("link", {
      name: "运行信息",
    });
    expect(runInfoLink).toHaveAttribute(
      "href",
      "/domain/development/project/flytesnacks/runs/abc123",
    );
    expect(screen.queryByRole("link", { name: "查看运行日志" })).toBeNull();
  });
});
