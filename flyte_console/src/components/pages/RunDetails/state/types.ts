import type { Timestamp } from '@bufbuild/protobuf/wkt'
import type { EnrichedAction } from '@/gen/flyteidl2/workflow/run_definition_pb'

export type ActionId = string

export type ActionWithChildren = EnrichedAction & {
  children: ActionId[]
  groupChildren: Record<string, ActionId[]>
  isGroup?: boolean
}

export type FlatRunNode = {
  depth: number
  groupTimestamps?: {
    endTime?: Timestamp
    startTime?: Timestamp
  }
  id: ActionId
  isGroup: boolean
  node: ActionWithChildren
}
