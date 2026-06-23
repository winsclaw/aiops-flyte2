/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { type Metadata } from 'next'

import React from 'react'
import { ProjectsClient } from './ProjectsClient'

export const metadata: Metadata = {
  title: '项目',
}

export default function Page() {
  return <ProjectsClient />
}
