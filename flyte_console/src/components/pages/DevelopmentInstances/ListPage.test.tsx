import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DevelopmentInstanceStatus } from "@/gen/flyteidl2/developmentinstance/development_instance_definition_pb";
import { DevelopmentInstancesListPage } from "./ListPage";

const mocks = vi.hoisted(() => ({
  listDevelopmentInstances: vi.fn(),
  startDevelopmentInstance: vi.fn(),
  stopDevelopmentInstance: vi.fn(),
  deleteDevelopmentInstance: vi.fn(),
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
    listDevelopmentInstances: mocks.listDevelopmentInstances,
    startDevelopmentInstance: mocks.startDevelopmentInstance,
    stopDevelopmentInstance: mocks.stopDevelopmentInstance,
    deleteDevelopmentInstance: mocks.deleteDevelopmentInstance,
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
}));

describe("DevelopmentInstancesListPage", () => {
  beforeEach(() => {
    mocks.listDevelopmentInstances.mockReset();
    mocks.startDevelopmentInstance.mockReset();
    mocks.stopDevelopmentInstance.mockReset();
    mocks.deleteDevelopmentInstance.mockReset();
  });

  it("renders display name, instance ID, and latest run ID without the description column", async () => {
    const sourceInstanceId = "ins-4a458z341d7k5o-5fef0df9";
    const runName = `${sourceInstanceId}-r1`;
    mocks.listDevelopmentInstances.mockResolvedValue({
      developmentInstances: [
        {
          id: { id: sourceInstanceId },
          org: "testorg",
          project: "flytesnacks",
          domain: "development",
          name: "中文实例",
          description: "用于调试",
          owner: "ljgong",
          status: DevelopmentInstanceStatus.RUNNING,
          latestRunName: runName,
          resourceSpec: { displayLabel: "2vCPU, 4GiB RAM, 20Gi 工作区" },
          access: { sshUser: "dev", nodePort: 31000 },
          createdAt: { seconds: 1781254800n, nanos: 0 },
        },
      ],
    });

    render(<DevelopmentInstancesListPage />);

    expect(screen.getByRole("columnheader", { name: "名称" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "实例 ID" })).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: "最新运行 ID" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("columnheader", { name: "描述" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("中文实例")).toBeVisible();
    expect(screen.getByText(sourceInstanceId)).toBeVisible();
    expect(screen.getByText(runName)).toBeVisible();
    expect(screen.queryByText("用于调试")).not.toBeInTheDocument();
  });
});
