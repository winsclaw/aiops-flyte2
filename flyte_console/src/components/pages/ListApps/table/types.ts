import type { App } from '@/gen/flyteidl2/app/app_definition_pb'

export type AppTableItem = {
  actions: App
  deployedBy?: string
  id?: unknown
  lastDeployed?: unknown
  name: {
    displayText: string
    endpoint: string
  }
  original: App
  replicas: {
    max: number
    min: number
  }
  status?: unknown
  type: string
}
