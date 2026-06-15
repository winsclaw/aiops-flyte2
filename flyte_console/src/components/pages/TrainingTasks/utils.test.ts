import { describe, expect, it } from "vitest";
import {
  ImageType,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  DEFAULT_OFFICIAL_IMAGE_ID,
  DEFAULT_RESOURCE_SPEC_ID,
  buildTrainingTaskInput,
  getTrainingTaskStatusText,
  validateTrainingTaskForm,
} from "./utils";

describe("training task helpers", () => {
  it("requires an execution command", () => {
    expect(
      validateTrainingTaskForm({
        name: "任务1",
        description: "",
        resourceSpecId: DEFAULT_RESOURCE_SPEC_ID,
        command: "",
        maxRuntimeHours: 1,
        imageType: ImageType.OFFICIAL,
        officialImageId: DEFAULT_OFFICIAL_IMAGE_ID,
        imageName: "",
        imageUri: "",
        cloudStorageMounts: [],
        codeRepositoryMounts: [],
      }),
    ).toBe("请输入执行命令");
  });

  it("uses the default official image and resource spec", () => {
    const input = buildTrainingTaskInput({
      name: "任务1",
      description: "测试",
      resourceSpecId: "",
      command: "echo hello",
      maxRuntimeHours: 0,
      imageType: ImageType.OFFICIAL,
      officialImageId: "",
      imageName: "",
      imageUri: "",
      cloudStorageMounts: [],
      codeRepositoryMounts: [
        { codeRepositoryId: "repo-1", mountPath: "/workspace/aione" },
      ],
    });

    expect(input.resourceSpecId).toBe(DEFAULT_RESOURCE_SPEC_ID);
    expect(input.officialImageId).toBe(DEFAULT_OFFICIAL_IMAGE_ID);
    expect(input.maxRuntimeHours).toBe(1);
    expect(input.codeRepositoryMounts[0]).toMatchObject({
      codeRepositoryId: "repo-1",
      mountPath: "/workspace/aione",
    });
  });

  it("requires custom image uri when custom image is selected", () => {
    expect(
      validateTrainingTaskForm({
        name: "任务1",
        description: "",
        resourceSpecId: DEFAULT_RESOURCE_SPEC_ID,
        command: "echo hello",
        maxRuntimeHours: 1,
        imageType: ImageType.CUSTOM,
        officialImageId: DEFAULT_OFFICIAL_IMAGE_ID,
        imageName: "",
        imageUri: "",
        cloudStorageMounts: [],
        codeRepositoryMounts: [],
      }),
    ).toBe("请输入自定义镜像地址");
  });

  it("maps training task status to Chinese labels", () => {
    expect(getTrainingTaskStatusText(TrainingTaskStatus.NOT_STARTED)).toBe(
      "未启动",
    );
    expect(getTrainingTaskStatusText(TrainingTaskStatus.RUNNING)).toBe(
      "运行中",
    );
    expect(getTrainingTaskStatusText(TrainingTaskStatus.FAILED)).toBe("失败");
  });
});
