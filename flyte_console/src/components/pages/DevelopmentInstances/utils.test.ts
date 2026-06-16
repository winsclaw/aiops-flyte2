import { describe, expect, it } from "vitest";
import {
  DEFAULT_NODE_PORT_RANGE,
  DELETED_DEVELOPMENT_INSTANCE_REASON,
  buildCreateDevelopmentInstanceRequest,
  buildRunIdentifier,
  formatDevelopmentInstance,
  getNextNodePort,
  isTerminalPhase,
} from "./utils";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import { create } from "@bufbuild/protobuf";
import {
  AbortInfoSchema,
  ActionDetailsSchema,
  ActionMetadataSchema,
  ActionSchema,
  RunSchema,
} from "@/gen/flyteidl2/workflow/run_definition_pb";
import {
  RunIdentifierSchema,
  UserIdentifierSchema,
} from "@/gen/flyteidl2/common/identifier_pb";
import {
  EnrichedIdentitySchema,
  UserSchema,
  UserSpecSchema,
} from "@/gen/flyteidl2/common/identity_pb";

describe("development instance helpers", () => {
  it("allocates the first unused default NodePort", () => {
    expect(getNextNodePort([31000, 31001], DEFAULT_NODE_PORT_RANGE)).toBe(
      31002,
    );
  });

  it("wraps NodePort allocation when the lower range has gaps", () => {
    expect(getNextNodePort([31000, 31002], DEFAULT_NODE_PORT_RANGE)).toBe(
      31001,
    );
  });

  it("throws when the NodePort range is exhausted", () => {
    expect(() =>
      getNextNodePort([31000, 31001], { min: 31000, max: 31001 }),
    ).toThrow("No available NodePort");
  });

  it("builds an ssh_workspace CreateRun request and preserves custom fields", () => {
    const request = buildCreateDevelopmentInstanceRequest({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: "devbox-a",
      description: "for notebooks",
      owner: "ljgong",
      image: "ubuntu:22.04",
      sshUser: "dev",
      authorizedKey: "ssh-rsa AAAA user@example",
      cpu: "2",
      memory: "4Gi",
      workspaceSize: "20Gi",
      nodePort: 31022,
      codeServerNodePort: 31023,
      maxHours: 24,
      cloudStorageMounts: [
        {
          cloudStorageId: "cs-1",
          pvcName: "cs-cs-1",
          storageClass: "bj1-ebs",
          size: "100Gi",
          mountPath: "/mnt/storage",
        },
      ],
      codeRepositories: [
        {
          id: "repo-1",
          repoUrl: "https://git.fzyun.io/serverless/aione.git",
          branch: "main",
          mountPath: "/workspace/aione",
          token: "",
        },
      ],
    });

    expect(request.id.case).toBe("runId");
    expect(request.task.case).toBe("taskSpec");
    expect(request.inputWrapper.case).toBe("inputs");
    if (request.task.case !== "taskSpec") {
      throw new Error("expected task spec");
    }
    expect(request.task.value.taskTemplate?.type).toBe("ssh_workspace");
    expect(request.task.value.taskTemplate?.custom).toMatchObject({
      image: "ubuntu:22.04",
      sshUser: "dev",
      authorizedKeys: ["ssh-rsa AAAA user@example"],
      cpu: "2",
      memory: "4Gi",
      workspaceSize: "20Gi",
      serviceType: "NodePort",
      nodePort: 31022,
      codeServerNodePort: 31023,
      description: "for notebooks",
      owner: "ljgong",
      maxHours: 24,
      cloudStorageMounts: [
        {
          cloudStorageId: "cs-1",
          pvcName: "cs-cs-1",
          storageClass: "bj1-ebs",
          size: "100Gi",
          mountPath: "/mnt/storage",
        },
      ],
      codeRepositories: [
        {
          id: "repo-1",
          repoUrl: "https://git.fzyun.io/serverless/aione.git",
          branch: "main",
          mountPath: "/workspace/aione",
          token: "",
        },
      ],
    });
  });

  it("formats run metadata into a development instance row", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "devbox-a",
          }),
        },
        status: {
          phase: ActionPhase.RUNNING,
          startTime: { seconds: BigInt(1781254800), nanos: 0 },
        },
        metadata: create(ActionMetadataSchema, {
          executedBy: create(EnrichedIdentitySchema, {
            principal: {
              case: "user",
              value: create(UserSchema, {
                id: create(UserIdentifierSchema, { subject: "ljgong" }),
                spec: create(UserSpecSchema, { userHandle: "ljgong" }),
              }),
            },
          }),
        }),
      }),
    });

    const instance = formatDevelopmentInstance(run);

    expect(instance?.name).toBe("devbox-a");
    expect(instance?.owner).toBe("ljgong");
    expect(instance?.status).toBe(ActionPhase.RUNNING);
  });

  it("hides runs marked as deleted by the development instance console", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "devbox-a",
          }),
        },
      }),
    });
    const actionDetails = create(ActionDetailsSchema, {
      result: {
        case: "abortInfo",
        value: create(AbortInfoSchema, {
          reason: DELETED_DEVELOPMENT_INSTANCE_REASON,
        }),
      },
    });

    expect(formatDevelopmentInstance(run, actionDetails)).toBeNull();
  });

  it("detects terminal phases and builds run identifiers", () => {
    expect(isTerminalPhase(ActionPhase.ABORTED)).toBe(true);
    expect(isTerminalPhase(ActionPhase.RUNNING)).toBe(false);
    expect(
      buildRunIdentifier("testorg", "flytesnacks", "development", "run-a"),
    ).toMatchObject({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: "run-a",
    });
  });
});
