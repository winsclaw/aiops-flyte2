/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeTabContent } from "./CodeTabContent";

const taskTemplate = {
  id: {
    name: "ssh_workspace",
    version: "tests",
  },
  type: "ssh_workspace",
  custom: {
    image: "flyte-ssh-workspace-code-server:4.19.0",
    sshUser: "dev",
    codeServerNodePort: 31080,
  },
};

describe("CodeTabContent", () => {
  afterEach(() => {
    cleanup();
  });

  it("embeds the development instance code-server when a code server NodePort is available", () => {
    render(<CodeTabContent taskTemplate={taskTemplate} />);

    const frame = screen.getByTitle("code-server");
    expect(frame).toHaveAttribute(
      "src",
      "http://localhost:31080/?folder=/workspace",
    );
    expect(screen.queryByText(/Task configuration/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Available in the licensed edition/i),
    ).not.toBeInTheDocument();
  });

  it("prefers the code-server workspace URL from task custom when available", () => {
    render(
      <CodeTabContent
        taskTemplate={{
          ...taskTemplate,
          custom: {
            ...taskTemplate.custom,
            codeServerWorkspaceUrl:
              "https://run-abc-code.ops.fzyun.io/?folder=/workspace",
          },
        }}
      />,
    );

    expect(screen.getByTitle("code-server")).toHaveAttribute(
      "src",
      "https://run-abc-code.ops.fzyun.io/?folder=/workspace",
    );
  });

  it("shows a not-installed message when the task does not expose code-server", () => {
    render(
      <CodeTabContent
        taskTemplate={{
          ...taskTemplate,
          custom: {
            image: "ubuntu:22.04",
            sshUser: "dev",
          },
        }}
      />,
    );

    expect(screen.getByText("code-server 未安装")).toBeInTheDocument();
    expect(screen.queryByTitle("code-server")).not.toBeInTheDocument();
  });
});
