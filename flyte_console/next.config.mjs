/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  basePath: '/v2',
  assetPrefix: '/v2',
  poweredByHeader: false,
  productionBrowserSourceMaps: true,
  reactStrictMode: null,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    path: '/v2/_next/image',
    minimumCacheTTL: 14400,
    localPatterns: [{ pathname: '**', search: '' }],
  },
  outputFileTracingIncludes: {
    '/**/*': ['./src/app/**/*.tsx'],
  },
  experimental: {
    mcpServer: true,
  },
}

export default nextConfig
