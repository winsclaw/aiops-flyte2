import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TrainingTaskSchema,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import { TrainingTaskFormPage } from "./FormPage";

const mocks = vi.hoisted(() => ({
  getTrainingTask: vi.fn(),
  listCloudStorages: vi.fn(),
  listCodeRepositories: vi.fn(),
  listOfficialImages: vi.fn(),
  listResourceSpecs: vi.fn(),
  push: vi.fn(),
}));

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
  }),
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams("edit=train-task"),
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
    getTrainingTask: mocks.getTrainingTask,
    listCloudStorages: mocks.listCloudStorages,
    listCodeRepositories: mocks.listCodeRepositories,
    listOfficialImages: mocks.listOfficialImages,
    listResourceSpecs: mocks.listResourceSpecs,
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "aione",
}));

describe("TrainingTaskFormPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.getTrainingTask.mockReset();
    mocks.listCloudStorages.mockReset();
    mocks.listCodeRepositories.mockReset();
    mocks.listOfficialImages.mockReset();
    mocks.listResourceSpecs.mockReset();
    mocks.push.mockReset();

    mocks.getTrainingTask.mockResolvedValue({
      trainingTask: create(TrainingTaskSchema, {
        name: "训练任务一",
        command: "python train.py",
        maxRuntimeHours: 1,
        status: TrainingTaskStatus.RUNNING,
      }),
    });
    mocks.listCloudStorages.mockResolvedValue({ cloudStorages: [] });
    mocks.listCodeRepositories.mockResolvedValue({ codeRepositories: [] });
    mocks.listOfficialImages.mockResolvedValue({ officialImages: [] });
    mocks.listResourceSpecs.mockResolvedValue({ resourceSpecs: [] });
  });

  it("shows a readable back link to the task detail page when editing", async () => {
    render(<TrainingTaskFormPage />);

    await waitFor(() => {
      expect(mocks.getTrainingTask).toHaveBeenCalled();
    });

    expect(await screen.findByRole("link", { name: "返回" })).toHaveAttribute(
      "href",
      "/domain/development/project/flytesnacks/training-tasks/train-task",
    );
  });
});
