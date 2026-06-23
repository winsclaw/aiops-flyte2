import type { ActionPhase } from '@/gen/flyteidl2/common/phase_pb'

export type GroupTableItem = {
  actionId?: string
  duration?: string
  name?: string
  phase?: ActionPhase
  startTime?: string
}
