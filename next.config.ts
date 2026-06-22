import type { NextConfig } from 'next'
import { securityHeaders } from './lib/security-headers'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
    ],
  },
  // WP2 / H4: enforced static security headers on every response, plus a production-only
  // Content-Security-Policy-Report-Only (see lib/security-headers.ts). Report-Only first; the
  // enforce flip + nonce middleware are a later cycle.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders(process.env.NODE_ENV === 'production'),
      },
    ]
  },
}

export default nextConfig
