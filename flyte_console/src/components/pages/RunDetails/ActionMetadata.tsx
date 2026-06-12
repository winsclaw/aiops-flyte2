/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

'use client'

import { CopyButton } from '@/components/CopyButton'
import { CopyButtonWithTooltip } from '@/components/CopyButtonWithTooltip'
import { TaskSpec } from '@/gen/flyteidl2/task/task_definition_pb'
import { ActionDetails } from '@/gen/flyteidl2/workflow/run_definition_pb'
import { useOrg } from '@/hooks/useOrg'
import { useTaskDetails } from '@/hooks/useTaskDetails'
import { getUiText } from '@/lib/uiText'
import { getLocation } from '@/lib/windowUtils'
import Link from 'next/link'

function getTaskIdFromAction(actionDetails: ActionDetails | undefined): {
  project: string
  domain: string
  name: string
  version: string
  org: string
} | null {
  if (!actionDetails?.spec?.case || actionDetails.spec.case !== 'task')
    return null
  const spec = actionDetails.spec.value as TaskSpec
  const id = spec?.taskTemplate?.id
  if (!id?.project || !id?.domain || !id?.name || !id?.version) return null
  return {
    project: id.project,
    domain: id.domain,
    name: id.name,
    version: id.version,
    org: id.org ?? '',
  }
}

export const ActionMetadata = ({
  actionDetails,
  cluster,
}: {
  actionDetails: ActionDetails | undefined
  cluster?: string
}) => {
  const org = useOrg()
  const taskId = getTaskIdFromAction(actionDetails)
  const taskDisplayName =
    actionDetails?.metadata?.spec?.case === 'task'
      ? (actionDetails?.metadata?.spec?.value?.shortName ??
        actionDetails?.metadata?.spec?.value?.id?.name ??
        '')
      : ''

  const taskName =
    actionDetails?.metadata?.spec?.case === 'task'
      ? actionDetails?.metadata?.spec?.value?.id?.name || ''
      : ''
  const taskCopyValue =
    actionDetails?.metadata?.spec?.case === 'task'
      ? actionDetails?.metadata?.spec?.value?.id?.name || ''
      : ''

  const taskDetailsQuery = useTaskDetails({
    ...taskId,
    name: taskId?.name ?? '',
    version: taskId?.version ?? '',
    project: taskId?.project ?? '',
    domain: taskId?.domain ?? '',
    org: taskId?.org || org,
    enabled: !!taskId,
  })

  const taskExists = !!taskDetailsQuery.data?.details
  const taskHref =
    taskId && taskExists
      ? `/domain/${taskId.domain}/project/${taskId.project}/tasks/${taskId.name}/${taskId.version}`
      : null

  return (
    <div>
      <div className="mb-1 flex gap-2">
        {taskDisplayName && (
          <h4 className="text-sm leading-[20px] font-bold tracking-tight text-(--system-gray-7)">
            {taskDisplayName}
          </h4>
        )}
        <CopyButtonWithTooltip
          icon="chain"
          textInitial={getUiText('copyActionUrl')}
          textCopied="操作链接已复制到剪贴板"
          value={getLocation().href}
          classNameBtn="-ml-1"
        />
      </div>

      <div className="flex items-center gap-3 text-2xs text-(--system-gray-5)">
        <div>
          操作 ID: <span>{actionDetails?.id?.name}</span>
          <CopyButton
            className="!px-1 !py-0"
            size="sm"
            value={actionDetails?.id?.name ?? ''}
          />
        </div>
        {taskName && (
          <div>
            {getUiText('task')}:{' '}
            {taskHref ? (
              <Link href={taskHref} className="hover:underline">
                {taskName}
              </Link>
            ) : (
              <span>{taskName}</span>
            )}
            <CopyButton
              className="!px-1 !py-0"
              size="sm"
              value={taskCopyValue || taskName}
            />
          </div>
        )}
        {cluster && <div>集群: {cluster}</div>}
      </div>
    </div>
  )
}
