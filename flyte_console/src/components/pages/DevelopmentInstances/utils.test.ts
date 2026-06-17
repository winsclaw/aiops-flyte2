import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
  DEFAULT_NODE_PORT_RANGE,
  DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES,
  DEVELOPMENT_INSTANCE_RESOURCE_SPECS,
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
  it("offers small 1c2g resource specs with and without T4", () => {
    expect(DEVELOPMENT_INSTANCE_RESOURCE_SPECS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cpu: "1",
          memory: "2Gi",
          workspaceSize: "20Gi",
          gpuCount: 0,
          label: "1vCPU, 2GiB RAM, 20Gi 工作区",
        }),
        expect.objectContaining({
          cpu: "1",
          memory: "2Gi",
          workspaceSize: "20Gi",
          gpuCount: 1,
          gpuModel: "NVIDIA T4",
          label: "1vCPU, 2GiB RAM, 1*NVIDIA T4, 20Gi 工作区",
        }),
      ]),
    );
  });

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
      imageType: "custom",
      officialImageId: DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
      image: "ubuntu:22.04",
      sshUser: "dev",
      authorizedKey: "ssh-rsa AAAA user@example",
      cpu: "2",
      memory: "4Gi",
      workspaceSize: "20Gi",
      gpuCount: 1,
      gpuModel: "NVIDIA T4",
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
      gpuCount: 1,
      gpuModel: "NVIDIA T4",
      serviceType: "NodePort",
      nodePort: 31022,
      codeServerNodePort: 31023,
      description: "for notebooks",
      owner: "ljgong",
      maxHours: 24,
      cloudStorageMounts: [
        {
          id: "cs-1",
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

  it("uses the official IDE image by default", () => {
    const defaultOfficialImage = DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES.find(
      (image) => image.id === DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
    );

    expect(defaultOfficialImage).toMatchObject({
      name: "官方编辑器",
      imageUri: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
    });

    const request = buildCreateDevelopmentInstanceRequest({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: "devbox-a",
      description: "",
      owner: "ljgong",
      imageType: "official",
      officialImageId: "",
      image: "",
      sshUser: "dev",
      authorizedKey: "ssh-rsa AAAA user@example",
      cpu: "2",
      memory: "4Gi",
      workspaceSize: "20Gi",
      gpuCount: 0,
      nodePort: 31022,
      codeServerNodePort: 31023,
      maxHours: 24,
    });

    if (request.task.case !== "taskSpec") {
      throw new Error("expected task spec");
    }
    expect(request.task.value.taskTemplate?.custom).toMatchObject({
      image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
      imageType: "official",
      officialImageId: DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
      imageName: "官方编辑器",
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
