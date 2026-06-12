export type NavPanelWidth = 'thin' | 'wide'
export type NavPanelType = 'default' | 'settings'
export type NavPanelMode = 'default' | 'settings'

type MakeHrefArgs = {
  project: string
  domain: string
  pathname?: string
}

export type NavLink = {
  className?: string
  displayText: string
  displayComponent?: React.ReactNode
  icon?: React.ReactNode
  makeHref: (args: MakeHrefArgs) => string
  onClick?: () => void
  prefetch?: boolean
  shouldHideIconOnCollapse?: boolean
  target?: string
  type: 'link'
}

export type NavSectionHeading = {
  className?: string
  displayText: string
  icon?: React.ReactNode
  type: 'heading'
}

export type NavWidget = {
  className?: string
  displayText: string
  type: 'widget'
  widget: (size: NavPanelWidth) => React.ReactNode
}

export type NavItemType = NavLink | NavSectionHeading | NavWidget
