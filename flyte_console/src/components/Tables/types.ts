export type BulkAction<T> = {
  makeLabel: (items: T[]) => string
  onClick: (
    items: T[],
    helpers: {
      clearNotification: () => void
      clearSelection: () => void
      showNotification: (props: NotificationProps) => void
    },
  ) => void
}

export type NotificationProps = {
  durationMs: number
  message: React.ReactNode
  undoCallback?: () => void
  variant?: 'success' | 'warn'
}
