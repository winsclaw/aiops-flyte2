import type { ActionPhase } from '@/gen/flyteidl2/common/phase_pb'
import type { Task } from '@/gen/flyteidl2/task/task_definition_pb'

export type TaskTableRow = {
  copyAction: Task
  createdAt: {
    date: string
    version?: string
  }
  createdUser?: string
  environment?: string
  lastRun?: {
    phase?: ActionPhase
    runId?: string
    time: string
  }
  name: {
    fullName?: React.ReactNode
    shortDescription?: React.ReactNode
    shortName?: React.ReactNode
  }
  original: Task
  trigger?: {
    active: boolean
    subtitle?: string
    title?: string
  }
}

export type TaskTableRowWithHighlights = TaskTableRow
