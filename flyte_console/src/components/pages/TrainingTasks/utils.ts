import { create } from "@bufbuild/protobuf";
import { CloudStorageMountSchema } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { CodeRepositoryMountSchema } from "@/gen/flyteidl2/aione/coderepository/code_repository_definition_pb";
import {
  ImageType,
  TrainingTaskStatus,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import { TrainingTaskInputSchema } from "@/gen/flyteidl2/trainingtask/training_task_service_pb";

export const DEFAULT_RESOURCE_SPEC_ID = "t4-8c-16g-1x";
export const DEFAULT_OFFICIAL_IMAGE_ID = "busybox";
export const DEFAULT_CUSTOM_IMAGE = "busybox:1.36";

export type TrainingTaskFormValues = {
  name: string;
  description: string;
  resourceSpecId: string;
  command: string;
  maxRuntimeHours: number;
  imageType: ImageType;
  officialImageId: string;
  imageName: string;
  imageUri: string;
  cloudStorageMounts: { cloudStorageId: string; mountPath: string }[];
  codeRepositoryMounts: { codeRepositoryId: string; mountPath: string }[];
};

export function validateTrainingTaskForm(values: TrainingTaskFormValues) {
  if (!values.name.trim()) {
    return "请输入名称";
  }
  if (!values.command.trim()) {
    return "请输入执行命令";
  }
  if (values.maxRuntimeHours < 1 || values.maxRuntimeHours > 360) {
    return "最长执行时间必须为 1-360 小时";
  }
  if (values.imageType === ImageType.CUSTOM && !values.imageUri.trim()) {
    return "请输入自定义镜像地址";
  }
  for (const mount of values.cloudStorageMounts) {
    if (!mount.mountPath.trim().startsWith("/")) {
      return "云存储挂载路径必须为绝对路径";
    }
  }
  const codeRepositoryMountPaths = new Set<string>();
  for (const mount of values.codeRepositoryMounts) {
    const mountPath = mount.mountPath.trim();
    if (!mountPath.startsWith("/")) {
      return "代码库挂载路径必须为绝对路径";
    }
    if (codeRepositoryMountPaths.has(mountPath)) {
      return "代码库挂载路径不能重复";
    }
    codeRepositoryMountPaths.add(mountPath);
  }
  return "";
}

export function buildTrainingTaskInput(values: TrainingTaskFormValues) {
  return create(TrainingTaskInputSchema, {
    name: values.name.trim(),
    description: values.description.trim(),
    resourceSpecId: values.resourceSpecId || DEFAULT_RESOURCE_SPEC_ID,
    command: values.command.trim(),
    maxRuntimeHours: values.maxRuntimeHours || 1,
    imageType: values.imageType,
    officialImageId:
      values.imageType === ImageType.OFFICIAL
        ? values.officialImageId || DEFAULT_OFFICIAL_IMAGE_ID
        : "",
    imageName:
      values.imageType === ImageType.CUSTOM
        ? values.imageName.trim() || values.imageUri.trim()
        : "",
    imageUri:
      values.imageType === ImageType.CUSTOM ? values.imageUri.trim() : "",
    cloudStorageMounts: values.cloudStorageMounts.map((mount) =>
      create(CloudStorageMountSchema, {
        cloudStorageId: mount.cloudStorageId,
        mountPath: mount.mountPath.trim(),
      }),
    ),
    codeRepositoryMounts: values.codeRepositoryMounts.map((mount) =>
      create(CodeRepositoryMountSchema, {
        codeRepositoryId: mount.codeRepositoryId,
        mountPath: mount.mountPath.trim(),
      }),
    ),
  });
}

export function getTrainingTaskStatusText(status: TrainingTaskStatus) {
  switch (status) {
    case TrainingTaskStatus.NOT_STARTED:
      return "未启动";
    case TrainingTaskStatus.RUNNING:
      return "运行中";
    case TrainingTaskStatus.SUCCEEDED:
      return "已完成";
    case TrainingTaskStatus.FAILED:
      return "失败";
    case TrainingTaskStatus.STOPPED:
      return "已停止";
    case TrainingTaskStatus.TIMED_OUT:
      return "已超时";
    default:
      return "未知";
  }
}

export function formatTimestamp(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "-";
  }
  return new Date(Number(timestamp.seconds) * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}
