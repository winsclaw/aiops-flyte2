import { describe, expect, it } from "vitest";
import {
  ImageType,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  DEFAULT_CUSTOM_IMAGE,
  DEFAULT_OFFICIAL_IMAGE_ID,
  DEFAULT_RESOURCE_SPEC_ID,
  buildTrainingTaskInput,
  getTrainingTaskStatusText,
  validateTrainingTaskForm,
  type TrainingTaskFormValues,
} from "./utils";

function baseValues(values: Partial<TrainingTaskFormValues> = {}) {
  return {
    name: "任务1",
    description: "",
    resourceSpecId: DEFAULT_RESOURCE_SPEC_ID,
    command: "echo hello",
    maxRuntimeHours: 1,
    imageType: ImageType.OFFICIAL,
    officialImageId: DEFAULT_OFFICIAL_IMAGE_ID,
    imageName: "",
    imageUri: "",
    cloudStorageMounts: [],
    codeRepositoryMounts: [],
    datasetMounts: [],
    ...values,
  } satisfies TrainingTaskFormValues;
}

describe("training task helpers", () => {
  it("requires an execution command", () => {
    expect(validateTrainingTaskForm(baseValues({ command: "" }))).toBe(
      "请输入执行命令",
    );
  });

  it("uses the default official image and resource spec", () => {
    const input = buildTrainingTaskInput(
      baseValues({
        description: "测试",
        resourceSpecId: "",
        maxRuntimeHours: 0,
        officialImageId: "",
        codeRepositoryMounts: [
          { codeRepositoryId: "repo-1", mountPath: "/workspace/aione" },
        ],
        datasetMounts: [{ datasetId: "dataset-1", targetPath: "/data/set1" }],
      }),
    );

    expect(input.resourceSpecId).toBe(DEFAULT_RESOURCE_SPEC_ID);
    expect(input.officialImageId).toBe(DEFAULT_OFFICIAL_IMAGE_ID);
    expect(input.maxRuntimeHours).toBe(1);
    expect(input.codeRepositoryMounts[0]).toMatchObject({
      codeRepositoryId: "repo-1",
      mountPath: "/workspace/aione",
    });
    expect(input.datasetMounts[0]).toMatchObject({
      datasetId: "dataset-1",
      targetPath: "/data/set1",
    });
  });

  it("uses the TensorFlow runtime image for image defaults", () => {
    expect(DEFAULT_CUSTOM_IMAGE).toBe(
      "docker.fzyun.io/tensorflow/tensorflow:latest",
    );
  });

  it("requires custom image uri when custom image is selected", () => {
    expect(
      validateTrainingTaskForm(
        baseValues({
          imageType: ImageType.CUSTOM,
          imageUri: "",
        }),
      ),
    ).toBe("请输入自定义镜像地址");
  });

  it("rejects duplicate mount paths across code and datasets", () => {
    expect(
      validateTrainingTaskForm(
        baseValues({
          codeRepositoryMounts: [
            { codeRepositoryId: "repo-1", mountPath: "/workspace/aione" },
          ],
          datasetMounts: [
            { datasetId: "dataset-1", targetPath: "/workspace/aione" },
          ],
        }),
      ),
    ).toBe("挂载路径不能重复");
  });

  it("maps training task status to Chinese labels", () => {
    expect(getTrainingTaskStatusText(TrainingTaskStatus.NOT_STARTED)).toBe(
      "未启动",
    );
    expect(getTrainingTaskStatusText(TrainingTaskStatus.RUNNING)).toBe("运行中");
    expect(getTrainingTaskStatusText(TrainingTaskStatus.FAILED)).toBe("失败");
  });
});
