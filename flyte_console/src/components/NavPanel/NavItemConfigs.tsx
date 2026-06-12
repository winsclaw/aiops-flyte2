/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { FLYTE_DOCS_FLYTE2_URL } from '@/lib/constants'
import { useDomainStore } from '@/lib/DomainStore'
import { formatRecentlyViewedLabel, getUiText } from '@/lib/uiText'
import { FolderIcon } from '@heroicons/react/16/solid'
import { DocumentTextIcon } from '@heroicons/react/20/solid'
import { ShareIcon } from '@heroicons/react/24/outline'
import { AppsIcon } from '../icons/AppsIcon'
import { RunsIcon } from '../icons/RunsIcon'
import { TriggersIcon } from '../icons/TriggersIcon'
import { EnterpriseCTA } from './EnterpriseCTA'
import { NavPanelWidth, NavWidget, type NavLink as NavLinkType } from './types'

export const ProjectsLink: NavLinkType = {
  className: 'semibold text-white',
  displayText: getUiText('projects'),
  makeHref: () => `/projects`,
  icon: <FolderIcon />,
  type: 'link',
  shouldHideIconOnCollapse: true,
}

const ProjectsHeaderWidget = ({ size }: { size: NavPanelWidth }) => {
  const { selectedDomain } = useDomainStore()
  if (!selectedDomain || size === 'thin') {
    return null
  }
  return (
    <span className="pl-2 text-2xs font-semibold dark:text-(--system-gray-5)">
      {formatRecentlyViewedLabel(selectedDomain.name)}
    </span>
  )
}

export const ProjectsHeader: NavWidget = {
  displayText: 'projectsHeader',
  type: 'widget',
  widget: (size) => <ProjectsHeaderWidget size={size} />,
}

export const RunsLink: NavLinkType = {
  displayText: getUiText('runs'),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/runs`,
  icon: <RunsIcon className="size-4" />,
  type: 'link',
}

export const TasksLink: NavLinkType = {
  displayText: getUiText('tasks'),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/tasks`,
  icon: <ShareIcon className="size-4 min-w-4" />,
  type: 'link',
}

export const TriggersLink: NavLinkType = {
  displayText: getUiText('triggers'),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/triggers`,
  icon: <TriggersIcon />,
  type: 'link',
}

export const AppsLink: NavLinkType = {
  displayText: getUiText('apps'),
  makeHref: ({ project, domain }) =>
    `/domain/${domain}/project/${project}/apps`,
  icon: <AppsIcon />,
  type: 'link',
}

export const useDefaultItems = () => {
  return [RunsLink, TriggersLink, TasksLink, AppsLink].filter(
    Boolean,
  ) as NavLinkType[]
}

export const DocumentationLink: NavLinkType = {
  displayText: getUiText('documentation'),
  makeHref: () => FLYTE_DOCS_FLYTE2_URL,
  icon: <DocumentTextIcon className="h-4" />,
  type: 'link',
  target: '_blank',
}

export const EnterpriseCTAWidget: NavWidget = {
  displayText: 'enterpriseCTA',
  type: 'widget',
  widget: (size) => <EnterpriseCTA size={size} />,
}

export const useDefaultOrgItems = () => [DocumentationLink, EnterpriseCTAWidget]
