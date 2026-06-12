/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  DescriptionListWrapper,
  SectionItem,
} from '@/components/DescriptionListWrapper'
import { LinkPill } from '@/components/Link'
import { LiveTimestamp } from '@/components/LiveTimestamp'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { PhaseBadge } from '@/components/PhaseBadge'
import { ChartIcon } from '@/components/icons/ChartIcon'
import { CacheLookupScope, RunSpec } from '@/gen/flyteidl2/task/run_pb'
import { TaskSpec } from '@/gen/flyteidl2/task/task_definition_pb'
import { GetRunDetailsResponse } from '@/gen/flyteidl2/workflow/run_service_pb'
import { useActionData } from '@/hooks/useActionData'
import { useTaskDetails } from '@/hooks/useTaskDetails'
import { toDateFormat } from '@/lib/dateUtils'
import { getUiText } from '@/lib/uiText'
import { getLocation } from '@/lib/windowUtils'
import { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { TriggerBadge } from '../TriggerBadge'
import { useRunStore } from '../state/RunStore'

const getCacheLookupScopeString: Record<CacheLookupScope, string> = {
  [CacheLookupScope.GLOBAL]: 'GLOBAL',
  [CacheLookupScope.PROJECT_DOMAIN]: 'PROJECT_DOMAIN',
  [CacheLookupScope.UNSPECIFIED]: '未指定',
}

/** Returns items as-is, or a single placeholder row when the list is empty. */
function withEmptyFallback(
  items: SectionItem[],
  emptyLabel: string,
): SectionItem[] {
  return items.length > 0 ? items : [{ name: emptyLabel, value: ' ' }]
}

export const RunInfoContent = ({
  runDetails,
}: {
  runDetails: UseQueryResult<GetRunDetailsResponse | null | undefined>
}) => {
  const liveRunStatus = useRunStore((s) => s.run?.action?.status)
  const livePhase = liveRunStatus?.phase

  const location = getLocation()
  const runUrl = useMemo(() => {
    return location.href.replace('localhost.', '').replace(':8080', '')
  }, [location])

  const taskSpec: TaskSpec | null = useMemo(() => {
    if (runDetails.data?.details?.action?.spec.case !== 'task') {
      return null
    }
    return runDetails.data?.details?.action?.spec.value
  }, [runDetails.data?.details?.action?.spec])

  const { data: taskDetails } = useTaskDetails({
    name: taskSpec?.taskTemplate?.id?.name || '',
    version: taskSpec?.taskTemplate?.id?.version || '',
    project: taskSpec?.taskTemplate?.id?.project || '',
    domain: taskSpec?.taskTemplate?.id?.domain || '',
    org: taskSpec?.taskTemplate?.id?.org || '',
    enabled:
      !!taskSpec?.taskTemplate?.id?.name &&
      !!taskSpec?.taskTemplate?.id?.version &&
      !!taskSpec?.taskTemplate?.id?.project &&
      !!taskSpec?.taskTemplate?.id?.domain &&
      !!taskSpec?.taskTemplate?.id?.org,
  })

  const taskData = useMemo(() => {
    return {
      fullTaskName: `${taskSpec?.environment?.name}.${taskSpec?.shortName}`,
      taskUrl: taskDetails?.details
        ? `/domain/${taskSpec?.taskTemplate?.id?.domain}/project/${taskSpec?.taskTemplate?.id?.project}/tasks/${taskDetails.details.taskId?.name}/${taskDetails.details.taskId?.version}`
        : '',
      taskVersion: taskDetails?.details
        ? taskDetails.details.taskId?.version
        : '-',
    }
  }, [taskSpec, taskDetails?.details])

  const { data: actionData } = useActionData({
    actionDetails: runDetails.data?.details?.action ?? null,
    enabled: !runDetails.isLoading,
  })

  const runSpec: RunSpec | undefined | null = useMemo(() => {
    if (!runDetails.data?.details?.runSpec) return null
    return runDetails.data?.details?.runSpec
  }, [runDetails.data?.details?.runSpec])

  const { annotations, envVars } = useMemo(() => {
    const annotations = withEmptyFallback(
      Object.entries(runSpec?.annotations?.values ?? {}).map(
        ([name, value]) => ({ name, value }),
      ),
      '无注解',
    )
    const envVars = withEmptyFallback(
      (runSpec?.envs?.values ?? []).map(({ key, value }) => ({
        name: key,
        value,
      })),
      '无环境变量',
    )
    return { annotations, envVars }
  }, [runSpec?.annotations?.values, runSpec?.envs?.values])

  const customContext = withEmptyFallback(
    (actionData?.inputs?.context ?? []).map(({ key, value }) => ({
      name: key,
      value,
    })),
    '无上下文',
  )

  if (runDetails.error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-5 text-center text-(--system-gray-5)">
        <div className="flex items-center gap-2">
          <ChartIcon /> 加载失败
        </div>
        <div>加载运行信息时遇到问题</div>
      </div>
    )
  }

  if (runDetails.isLoading) {
    return (
      <div className="flex h-full items-center p-5">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="overflow-y-auto">
      <DescriptionListWrapper
        isRawView={false}
        sections={[
          {
            id: 'summary',
            name: '运行详情',
            items: [
              {
                name: '运行名称',
                value: runDetails.data?.details?.action?.id?.run?.name,
                copyBtn: true,
              },
              {
                name: '运行链接',
                value: runUrl,
                copyBtn: true,
              },
              {
                name: '根任务',
                value:
                  taskSpec &&
                  taskDetails?.details &&
                  taskData.fullTaskName &&
                  taskData.taskUrl ? (
                    <LinkPill
                      displayText={taskData.fullTaskName}
                      href={taskData.taskUrl}
                    />
                  ) : (
                    '-'
                  ),
              },
              {
                name: '根任务版本',
                value: taskData.taskVersion,
                copyBtn: taskData.taskVersion !== '-',
              },
              {
                name: getUiText('status'),
                value: <PhaseBadge phase={livePhase} />,
              },
              {
                name: getUiText('duration'),
                value: (
                  <LiveTimestamp
                    className="text-sm font-medium"
                    endTimestamp={liveRunStatus?.endTime}
                    timestamp={liveRunStatus?.startTime}
                  />
                ),
              },
              {
                name: getUiText('startTime'),
                value: toDateFormat({
                  timestamp:
                    runDetails.data?.details?.action?.status?.startTime,
                }),
              },
              {
                name: getUiText('endTime'),
                value: toDateFormat({
                  timestamp: runDetails.data?.details?.action?.status?.endTime,
                }),
              },
              {
                name: '尝试次数',
                value: runDetails.data?.details?.action?.status?.attempts,
              },
              {
                name: getUiText('trigger'),
                value: (
                  <TriggerBadge action={runDetails.data?.details?.action} />
                ),
              },
            ],
          },
        ]}
      />
      <DescriptionListWrapper
        isRawView={false}
        sections={[
          {
            id: 'runSpec',
            name: '运行规格',
            items: [
              {
                name: '集群',
                value: runSpec?.cluster,
                copyBtn: true,
              },
              {
                name: '原始数据存储',
                value: runSpec?.rawDataStorage?.rawDataPrefix,
                copyBtn: true,
              },
              {
                name: '缓存配置',
                value:
                  getCacheLookupScopeString[
                    runSpec?.cacheConfig?.cacheLookupScope ||
                      CacheLookupScope.UNSPECIFIED
                  ],
              },
            ],
          },
        ]}
      />
      <DescriptionListWrapper
        isRawView={false}
        sections={[
          {
            id: 'Annotations',
            name: '注解',
            items: annotations,
          },
        ]}
      />
      <DescriptionListWrapper
        isRawView={false}
        sections={[
          {
            id: 'EnvVars',
            name: '环境变量',
            items: envVars,
          },
        ]}
      />
      <DescriptionListWrapper
        isRawView={false}
        sections={[
          {
            id: 'CustomContext',
            name: '自定义上下文',
            items: customContext,
          },
        ]}
      />
    </div>
  )
}
