/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { PopoverMenu, type MenuItem } from '@/components/Popovers'
import { StatusIcon } from '@/components/StatusIcons'
import { ActionPhase } from '@/gen/flyteidl2/common/phase_pb'
import { useQueryFilters } from '@/hooks/useQueryFilters'
import { getPhaseLabel, getUiText } from '@/lib/uiText'
import { useMemo } from 'react'

type FilterConfig = {
  label: string
  phase: ActionPhase
  value: keyof typeof ActionPhase
}

export const filterConfigs: FilterConfig[] = [
  {
    label: getPhaseLabel('SUCCEEDED'),
    phase: ActionPhase.SUCCEEDED,
    value: 'SUCCEEDED',
  },
  {
    label: getPhaseLabel('QUEUED'),
    phase: ActionPhase.QUEUED,
    value: 'QUEUED',
  },
  {
    label: getPhaseLabel('WAITING_FOR_RESOURCES'),
    phase: ActionPhase.WAITING_FOR_RESOURCES,
    value: 'WAITING_FOR_RESOURCES',
  },
  {
    label: getPhaseLabel('INITIALIZING'),
    phase: ActionPhase.INITIALIZING,
    value: 'INITIALIZING',
  },
  {
    label: getPhaseLabel('RUNNING'),
    phase: ActionPhase.RUNNING,
    value: 'RUNNING',
  },
  {
    label: getPhaseLabel('TIMED_OUT'),
    phase: ActionPhase.TIMED_OUT,
    value: 'TIMED_OUT',
  },
  {
    label: getPhaseLabel('ABORTED'),
    phase: ActionPhase.ABORTED,
    value: 'ABORTED',
  },
  {
    label: getPhaseLabel('FAILED'),
    phase: ActionPhase.FAILED,
    value: 'FAILED',
  },
]

export const useStatusFilterMenuItems = () => {
  const { filters, toggleFilter } = useQueryFilters()
  const menuItems: MenuItem[] = useMemo(() => {
    return filterConfigs.map((config) => ({
      id: config.label,
      label: config.label,
      onClick: () => toggleFilter({ type: 'status', status: config.value }),
      selected: !!filters.status?.includes(config.value),
      type: 'item',
      icon: <StatusIcon phase={config.phase} isStatic={true} />,
    }))
  }, [filters.status, toggleFilter])
  return menuItems
}

export const StatusFilter = () => {
  const { filters, clearFilter } = useQueryFilters()
  const menuItems = useStatusFilterMenuItems()
  return (
    <PopoverMenu
      label={getUiText('status')}
      items={menuItems}
      variant="filter"
      menuClassName="min-w-56"
      filterProps={{
        displayedValues: (
          <div className="flex items-center">
            {filters.status?.slice(0, 3).map((s) => (
              <StatusIcon
                key={s}
                phase={ActionPhase[s as keyof typeof ActionPhase]}
                isStatic={true}
              />
            ))}
          </div>
        ),
        valuesCount: filters.status?.length || 0,
        onClearClick: () => clearFilter(),
      }}
      closeOnItemClick={false}
    />
  )
}
