import type { Task } from '@/gen/flyteidl2/task/task_definition_pb'

export type CreateTriggerTab = 'definition' | 'inputs' | 'settings'
export type TriggerMode = 'select-task' | 'create-trigger'

export type TaskDetails = {
  task?: Task
  taskName?: string
  taskVersion?: string
  [key: string]: unknown
}

export type TableTask = {
  original?: Task
  [key: string]: unknown
}
