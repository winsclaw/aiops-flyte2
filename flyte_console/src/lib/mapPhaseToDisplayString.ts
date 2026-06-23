/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { ActionPhase } from '@/gen/flyteidl2/common/phase_pb'
import { getPhaseLabel } from '@/lib/uiText'

export const mapPhaseToDisplayString: Record<ActionPhase, string> = {
  [ActionPhase.ABORTED]: getPhaseLabel('ABORTED'),
  [ActionPhase.FAILED]: getPhaseLabel('FAILED'),
  [ActionPhase.INITIALIZING]: getPhaseLabel('INITIALIZING'),
  [ActionPhase.QUEUED]: getPhaseLabel('QUEUED'),
  [ActionPhase.RUNNING]: getPhaseLabel('RUNNING'),
  [ActionPhase.SUCCEEDED]: getPhaseLabel('SUCCEEDED'),
  [ActionPhase.TIMED_OUT]: getPhaseLabel('TIMED_OUT'),
  [ActionPhase.UNSPECIFIED]: getPhaseLabel('UNSPECIFIED'),
  [ActionPhase.WAITING_FOR_RESOURCES]: getPhaseLabel('WAITING_FOR_RESOURCES'),
}
