/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  addMinutes,
  startOfToday,
  endOfToday,
  startOfYesterday,
  subMinutes,
  subHours,
  subDays,
  subMonths,
} from 'date-fns'
import { DateRange } from 'react-day-picker'

export type QuickRangeItem = {
  filterLabel: string // display only: to create filter label
  label: string // display in quickRange menu but also used as unique key for linking params to date-ranges
  getRange: () => DateRange
}

export type QuickRangeDivider = { type: 'divider' }

export type QuickRange = QuickRangeItem | QuickRangeDivider

export const QUICK_RANGE_DIVIDER: QuickRangeDivider = { type: 'divider' }

export const isQuickRangeItem = (qr: QuickRange): qr is QuickRangeItem =>
  !('type' in qr && qr.type === 'divider')

export const labeledQuickRanges: QuickRange[] = [
  {
    filterLabel: '今天',
    label: '今天',
    getRange: () => ({ from: startOfToday(), to: endOfToday() }),
  },
  {
    filterLabel: '昨天',
    label: '昨天',
    getRange: () => {
      const y = startOfYesterday()
      return { from: y, to: new Date(y.getTime() + 24 * 60 * 60 * 1000 - 1) }
    },
  },
  QUICK_RANGE_DIVIDER,
  {
    filterLabel: '最近 5 分钟',
    label: '最近 5 分钟',
    getRange: () => ({
      from: subMinutes(new Date(), 5),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 30 分钟',
    label: '最近 30 分钟',
    getRange: () => ({
      from: subMinutes(new Date(), 30),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 1 小时',
    label: '最近 1 小时',
    getRange: () => ({
      from: subHours(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 7 天',
    label: '最近 7 天',
    getRange: () => ({
      from: subDays(new Date(), 7),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 30 天',
    label: '最近 30 天',
    getRange: () => ({
      from: subDays(new Date(), 30),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 90 天',
    label: '最近 90 天',
    getRange: () => ({
      from: subDays(new Date(), 90),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 12 个月',
    label: '最近 12 个月',
    getRange: () => ({
      from: subMonths(new Date(), 12),
      to: new Date(),
    }),
  },
  QUICK_RANGE_DIVIDER,
  {
    filterLabel: '上周',
    label: '上周',
    getRange: () => {
      const today = new Date()
      const start = subDays(today, today.getDay() + 6)
      const end = subDays(today, today.getDay())
      return { from: start, to: end }
    },
  },
  {
    filterLabel: '上个月',
    label: '上个月',
    getRange: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: start, to: end }
    },
  },
]

/**
 * Quick ranges constrained to a maximum of 30 days.
 * Useful for APIs that have a 30-day lookback limit.
 */
export const quickRanges30Days: QuickRange[] = [
  {
    filterLabel: '今天',
    label: '今天',
    getRange: () => ({ from: startOfToday(), to: endOfToday() }),
  },
  {
    filterLabel: '昨天',
    label: '昨天',
    getRange: () => {
      const y = startOfYesterday()
      return { from: y, to: new Date(y.getTime() + 24 * 60 * 60 * 1000 - 1) }
    },
  },
  QUICK_RANGE_DIVIDER,
  {
    filterLabel: '最近 5 分钟',
    label: '最近 5 分钟',
    getRange: () => ({
      from: subMinutes(new Date(), 5),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 30 分钟',
    label: '最近 30 分钟',
    getRange: () => ({
      from: subMinutes(new Date(), 30),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 1 小时',
    label: '最近 1 小时',
    getRange: () => ({
      from: subHours(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 7 天',
    label: '最近 7 天',
    getRange: () => ({
      from: subDays(new Date(), 7),
      to: new Date(),
    }),
  },
  // by querying for a time 15 minutes more recent than exactly 30 days ago, we prevent the api from throwing
  // an error since it only retains exactly 30 days worth of data
  {
    filterLabel: '最近 30 天',
    label: '最近 30 天',
    getRange: () => ({
      from: addMinutes(subDays(new Date(), 30), 15),
      to: new Date(),
    }),
  },
]

export const quickRanges7Days: QuickRange[] = [
  {
    filterLabel: '今天',
    label: '今天',
    getRange: () => ({ from: startOfToday(), to: endOfToday() }),
  },
  {
    filterLabel: '昨天',
    label: '昨天',
    getRange: () => {
      const y = startOfYesterday()
      return { from: y, to: new Date(y.getTime() + 24 * 60 * 60 * 1000 - 1) }
    },
  },
  QUICK_RANGE_DIVIDER,
  {
    filterLabel: '最近 5 分钟',
    label: '最近 5 分钟',
    getRange: () => ({
      from: subMinutes(new Date(), 5),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 30 分钟',
    label: '最近 30 分钟',
    getRange: () => ({
      from: subMinutes(new Date(), 30),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 1 小时',
    label: '最近 1 小时',
    getRange: () => ({
      from: subHours(new Date(), 1),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 3 天',
    label: '最近 3 天',
    getRange: () => ({
      from: subDays(new Date(), 3),
      to: new Date(),
    }),
  },
  {
    filterLabel: '最近 7 天',
    label: '最近 7 天',
    getRange: () => ({
      from: subDays(new Date(), 7),
      to: new Date(),
    }),
  },
]
