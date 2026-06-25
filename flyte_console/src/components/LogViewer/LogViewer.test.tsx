import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunLogType } from "@/components/pages/RunDetails/types";
import { LogViewer } from "./LogViewer";

describe("LogViewer errors", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses the provided NotFound message for cleared run pods", () => {
    vi.useFakeTimers();
    render(
      <LogViewer
        done
        error={new ConnectError("pod missing", Code.NotFound)}
        logType={RunLogType.RUN}
        notFoundErrorMessage="pod 已清理，历史日志不可用"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("Error")).toBeVisible();
    expect(screen.getByText("pod 已清理，历史日志不可用")).toBeVisible();
  });

  it("keeps the generic message when no NotFound override is provided", () => {
    vi.useFakeTimers();
    render(
      <LogViewer
        done
        error={new ConnectError("pod missing", Code.NotFound)}
        logType={RunLogType.RUN}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(
      screen.getByText("We're having trouble loading the logs"),
    ).toBeVisible();
  });
});
