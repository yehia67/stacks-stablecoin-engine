import type { Metadata } from 'next'
import './globals.css'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { StacksProvider } from '@/components/providers/StacksProvider'

export const metadata: Metadata = {
  title: 'Stacks Stablecoin Engine',
  description: 'Bitcoin-backed stablecoins on Stacks',
  icons: {
    icon: '/logo.jpg',
    shortcut: '/logo.jpg',
    apple: '/logo.jpg',
  },
  openGraph: {
    images: ['/logo.jpg'],
  },
  twitter: {
    images: ['/logo.jpg'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <StacksProvider>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </StacksProvider>
      </body>
    </html>
  )
}
