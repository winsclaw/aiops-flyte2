export type KVPair = {
  key: string
  value: string
}

export type CronTrigger = {
  cronExpression?: string
  timezone?: string
}

export type FixedRateTrigger = {
  duration?: string
}

export type CreateTriggerState = {
  activeOnCreation?: boolean
  annotations?: KVPair[]
  cron?: CronTrigger
  description?: string
  envVars?: KVPair[]
  fixedRate?: FixedRateTrigger
  inputs?: Record<string, unknown>
  labels?: KVPair[]
  name?: string
  overwriteCache?: boolean
  scheduleType?: string
  triggerDefinition?: string
  [key: string]: unknown
}
