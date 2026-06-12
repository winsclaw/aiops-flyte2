/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

// import React from 'react'
import { type Metadata } from 'next'
import { ListTriggersPage } from '@/components/pages/ListTriggers'

export const metadata: Metadata = {
  title: '触发器',
}

export default function Home() {
  return <ListTriggersPage />
}
