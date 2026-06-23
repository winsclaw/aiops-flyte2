/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { type Metadata } from 'next'

export const metadata: Metadata = {
  title: '运行详情',
}

export default function RunDetailsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
