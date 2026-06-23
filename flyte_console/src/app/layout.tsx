/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { Providers } from '@/app/providers'
import { type Metadata } from 'next'

import '@/styles/tailwind.css'

import { EnvScript, env } from 'next-runtime-env'

export const metadata: Metadata = {
  title: {
    template: '%s | Flyte 2',
    default: 'Flyte 2',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const envLoader = {
    NODE_ENV: env('NODE_ENV'),
  }

  return (
    <html lang="zh-CN" className="h-full min-h-full" suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8"></meta>
        <EnvScript env={envLoader} disableNextScript />
      </head>
      <body className="light:bg-white flex h-full overflow-hidden overscroll-none antialiased">
        <Providers>
          <div className="h-full min-h-0 w-full">{children}</div>
        </Providers>
      </body>
    </html>
  )
}
