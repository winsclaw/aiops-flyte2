import type { Project } from '@/gen/flyteidl2/project/project_service_pb'

export type NewProject = {
  description?: string
  id: string
  name?: string
}

export type ArchiveRestoreProjectItem = {
  project: Project
  restoring?: boolean
}

export type ProjectArchiveRestoreDialogProps = {
  item: ArchiveRestoreProjectItem | null
  onClose: () => void
}
