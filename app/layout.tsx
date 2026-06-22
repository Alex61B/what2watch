import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import './globals.css'
import SessionProviderWrapper from '@/components/SessionProviderWrapper'
import ThemeProvider from '@/components/ThemeProvider'
import ThemeToggle from '@/components/ThemeToggle'
import AnalyticsTracker from '@/components/AnalyticsTracker'
import { BRAND_NAME } from '@/lib/brand'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
})

export const metadata: Metadata = {
  // metadataBase resolves relative OG/canonical URLs. Driven by NEXT_PUBLIC_SITE_URL in prod
  // (a launch prerequisite — set it to [PROD_DOMAIN] in Vercel); falls back to localhost for dev.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: BRAND_NAME,
  description: 'Less time piking, more time flixing.',
}

// Runs before paint so the right theme class is on <html> immediately — no
// flash of the wrong theme on load. Defaults to LIGHT (the editorial PikFlix
// look); the `dark` class is only added when the visitor has explicitly chosen
// dark before.
const themeInitScript = `(function(){try{if(localStorage.getItem('w2w_theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${playfair.variable} font-sans`}>
        <ThemeProvider>
          <ThemeToggle />
          <SessionProviderWrapper>
            <AnalyticsTracker />
            {children}
          </SessionProviderWrapper>
        </ThemeProvider>
      </body>
    </html>
  )
}
