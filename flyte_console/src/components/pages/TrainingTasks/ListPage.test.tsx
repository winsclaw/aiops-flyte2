import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrainingTaskStatus } from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import { StatusPill } from "./ListPage";

describe("TrainingTasksListPage status", () => {
  it("shows the failure reason next to failed tasks", () => {
    render(
      <StatusPill
        status={TrainingTaskStatus.FAILED}
        statusMessage="镜像拉取失败"
      />,
    );

    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("镜像拉取失败")).toBeInTheDocument();
  });
});
