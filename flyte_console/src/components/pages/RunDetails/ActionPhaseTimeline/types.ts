import type { ActionPhase } from '@/gen/flyteidl2/common/phase_pb'

export type TooltipPhaseSection = {
  phase?: ActionPhase
  duration?: string
  label?: string
}

export type TooltipSection = TooltipPhaseSection & {
  accentColor?: string
  title?: string
}

export type TimelineObject = {
  accentColor?: string
  duration?: number
  end?: number
  phase?: ActionPhase
  start?: number
  tooltipSections?: TooltipSection[]
}
