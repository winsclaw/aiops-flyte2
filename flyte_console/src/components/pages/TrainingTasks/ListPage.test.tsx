import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrainingTaskStatus } from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import { StatusPill } from "./ListPage";

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
