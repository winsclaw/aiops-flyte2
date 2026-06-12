import type { TriggerName } from '@/gen/flyteidl2/common/identifier_pb'
import type { Trigger } from '@/gen/flyteidl2/trigger/trigger_definition_pb'

export type TriggerTableRow = {
  actions: Trigger
  active: {
    id: string
    status: boolean
  }
  createdDate?: string
  createdUser?: string
  name: {
    name?: React.ReactNode
    nextRun?: string
    schedule?: string
  }
  nextRun?: string
  task?: TriggerName
  triggered: {
    date: string
  }
  updated: {
    date: string
    updatedBy?: string
  }
}

export type TriggerTableRowWithHighlights = TriggerTableRow
