import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DatasetFormPage } from "./FormPage";

const mocks = vi.hoisted(() => ({
  createDataset: vi.fn(),
  getDataset: vi.fn(),
  updateDataset: vi.fn(),
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
    createDataset: mocks.createDataset,
    getDataset: mocks.getDataset,
    updateDataset: mocks.updateDataset,
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "aione",
}));

describe("DatasetFormPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.createDataset.mockReset();
    mocks.getDataset.mockReset();
    mocks.updateDataset.mockReset();
    mocks.push.mockReset();
    mocks.createDataset.mockResolvedValue({ dataset: {} });
  });

  it("submits independent object storage fields and keeps secret key masked", async () => {
    const user = userEvent.setup();
    render(<DatasetFormPage />);

    expect(screen.queryByText("项目内公开")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("请输入名称"), "语音识别");
    await user.type(
      screen.getByPlaceholderText("请输入描述"),
      "training speech",
    );
    await user.type(
      screen.getByPlaceholderText("请输入 EndPoint"),
      "http://minio.flyte.svc",
    );
    await user.type(screen.getByPlaceholderText("请输入 Port"), "9000");
    await user.type(screen.getByPlaceholderText("请输入 AccessKey"), "rustfs");
    await user.type(
      screen.getByPlaceholderText("请输入 SecretKey"),
      "rustfsstorage",
    );
    await user.type(
      screen.getByPlaceholderText("请输入 TargetPath"),
      "/mnt/datasets",
    );
    await user.type(screen.getByPlaceholderText("请输入 Bucket"), "datasets");
    await user.type(
      screen.getByPlaceholderText("请输入 BucketPath"),
      "/data/speech/",
    );

    expect(screen.getByPlaceholderText("请输入 SecretKey")).toHaveAttribute(
      "type",
      "password",
    );

    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(mocks.createDataset).toHaveBeenCalledTimes(1);
    });
    const request = mocks.createDataset.mock.calls[0][0];
    expect(request.dataset).toMatchObject({
      name: "语音识别",
      description: "training speech",
      endPoint: "http://minio.flyte.svc",
      port: "9000",
      accessKey: "rustfs",
      secretKey: "rustfsstorage",
      targetPath: "/mnt/datasets",
      bucket: "datasets",
      bucketPath: "data/speech/",
    });
  });
});
