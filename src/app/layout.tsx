import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import 'katex/dist/katex.min.css'
import { ThemeProvider } from '@/components/layout/ThemeProvider'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' })

// Next rewrites <Link>/asset URLs for basePath, but not metadata URLs or raw
// <link href> strings — on GitHub Pages a bare "/manifest.json" resolves to the
// domain root and 404s, so the base path has to be applied by hand.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata: Metadata = {
  title: 'Nemo — Study Smarter',
  description: 'Spaced repetition, flashcards, notes, and analytics — all in one place.',
  manifest: `${basePath}/manifest.json`,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark h-full ${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0f0f11" />
        {/* No <link rel="manifest"> here — `metadata.manifest` above already
            emits one, and hardcoding a second produced a duplicate tag whose
            root-absolute href 404'd under the /Nemos-Study base path. */}
      </head>
      <body className="h-full" suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
