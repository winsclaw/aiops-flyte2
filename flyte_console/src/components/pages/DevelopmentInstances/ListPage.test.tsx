import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import { RunIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { TaskTemplateSchema } from "@/gen/flyteidl2/core/tasks_pb";
import {
  ActionDetailsSchema,
  ActionSchema,
  RunSchema,
} from "@/gen/flyteidl2/workflow/run_definition_pb";
import { create } from "@bufbuild/protobuf";
import { DevelopmentInstancesListPage } from "./ListPage";

const mocks = vi.hoisted(() => ({
  abortRun: vi.fn(),
  createRun: vi.fn(),
  getRunDetails: vi.fn(),
  refetch: vi.fn(),
  runs: [] as unknown[],
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
    abortRun: mocks.abortRun,
    createRun: mocks.createRun,
    getRunDetails: mocks.getRunDetails,
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "testorg",
}));

vi.mock("@/hooks/useWatchRuns", () => ({
  useWatchRuns: () => ({
    data: { pages: [{ runs: mocks.runs }] },
    isFetching: false,
    refetch: mocks.refetch,
  }),
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
}));

describe("DevelopmentInstancesListPage", () => {
  beforeEach(() => {
    mocks.abortRun.mockReset();
    mocks.createRun.mockReset();
    mocks.getRunDetails.mockReset();
    mocks.refetch.mockReset();
    mocks.runs = [];
  });

  it("renders display name and run ID without the description column", async () => {
    const sourceInstanceId = "ins-4a458z341d7k5o-5fef0df9";
    const runName = `${sourceInstanceId}-r1`;
    mocks.runs = [
      create(RunSchema, {
        action: create(ActionSchema, {
          id: {
            run: create(RunIdentifierSchema, {
              org: "testorg",
              project: "flytesnacks",
              domain: "development",
              name: runName,
            }),
          },
          status: {
            phase: ActionPhase.RUNNING,
            startTime: { seconds: 1781254800n, nanos: 0 },
          },
        }),
      }),
    ];
    mocks.getRunDetails.mockResolvedValue({
      details: {
        action: create(ActionDetailsSchema, {
          spec: {
            case: "task",
            value: {
              taskTemplate: create(TaskTemplateSchema, {
                custom: {
                  sourceName: "中文实例",
                  sourceInstanceId,
                  description: "用于调试",
                },
              }),
            },
          },
        }),
      },
    });

    render(<DevelopmentInstancesListPage />);

    expect(screen.getByRole("columnheader", { name: "名称" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "运行 ID" })).toBeVisible();
    expect(
      screen.queryByRole("columnheader", { name: "描述" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("中文实例")).toBeVisible();
    expect(screen.getByText(runName)).toBeVisible();
    expect(screen.queryByText("用于调试")).not.toBeInTheDocument();
  });
});
