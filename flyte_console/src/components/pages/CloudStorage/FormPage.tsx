/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import {
  CloudStorageInputSchema,
  CloudStorageService,
  CreateCloudStorageRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon, PlusIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const fieldClass =
  "mt-1 w-full border border-zinc-400 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";

export function CloudStorageFormPage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(CloudStorageService);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sizeGb, setSizeGb] = useState(1);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const listHref = `/domain/${params.domain}/project/${params.project}/cloud-storages`;
  const projectId = useMemo(
    () =>
      params.domain && params.project && org
        ? create(ProjectIdentifierSchema, {
            organization: org,
            domain: params.domain,
            name: params.project,
          })
        : undefined,
    [params.domain, params.project, org],
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!projectId) {
      setError("项目上下文未加载完成");
      return;
    }
    if (!name.trim()) {
      setError("请输入名称");
      return;
    }
    if (sizeGb < 1 || sizeGb > 1000) {
      setError("空间大小必须为 1-1000GB");
      return;
    }
    setIsSubmitting(true);
    try {
      await client.createCloudStorage(
        create(CreateCloudStorageRequestSchema, {
          project: projectId,
          creator: "liu.cd",
          cloudStorage: create(CloudStorageInputSchema, {
            name: name.trim(),
            description: description.trim(),
            sizeGb,
          }),
        }),
      );
      router.push(listHref);
    } catch (submitError) {
      console.error("Error creating cloud storage", submitError);
      setError("创建云存储失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex items-center gap-3">
              <Link
                href={listHref}
                className="inline-flex size-9 items-center justify-center border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeftIcon className="size-5" />
              </Link>
              <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">
                创建云存储
              </h1>
            </div>

            <form onSubmit={onSubmit} className="max-w-4xl space-y-5">
              <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                  基本信息
                </div>
                <div className="grid gap-4 p-5">
                  <label className={labelClass}>
                    名称
                    <input
                      className={fieldClass}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="请输入名称"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      1-128 个字符。
                    </span>
                  </label>
                  <label className={labelClass}>
                    描述 - 可选
                    <textarea
                      className={`${fieldClass} min-h-32`}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="请输入描述"
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      最多 255 个字符。
                    </span>
                  </label>
                  <label className={labelClass}>
                    空间大小（GB）
                    <input
                      className={fieldClass}
                      type="number"
                      min={1}
                      max={1000}
                      value={sizeGb}
                      onChange={(event) => setSizeGb(Number(event.target.value))}
                    />
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      1-1000GB。
                    </span>
                  </label>
                </div>
              </section>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex gap-3 pb-8">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex h-10 items-center justify-center gap-2 bg-orange-500 px-5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  <PlusIcon className="size-5" />
                  {isSubmitting ? "创建中" : "创建"}
                </button>
                <Link
                  href={listHref}
                  className="inline-flex h-10 items-center justify-center border border-zinc-300 px-5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                >
                  取消
                </Link>
              </div>
            </form>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}
