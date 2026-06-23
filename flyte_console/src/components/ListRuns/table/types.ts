import type { ActionPhase } from '@/gen/flyteidl2/common/phase_pb'
import type { Run } from '@/gen/flyteidl2/workflow/run_definition_pb'

export type RunsTableRow = {
  actions: {
    actionId?: string
    latestVersion?: string
    runId?: string
    url: string
  }
  endTime: string
  environment?: string
  name: {
    fullName?: string
    shortName?: string
  }
  original: Run
  runId: {
    id?: string
    status?: ActionPhase
  }
  runTime: string
  startTime: string
  trigger: {
    name?: string
    type?: string
  }
  user?: string
}
