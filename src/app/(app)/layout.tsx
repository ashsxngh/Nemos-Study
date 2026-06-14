import { ClientOnly } from '@/components/layout/ClientOnly'
import { Sidebar } from '@/components/layout/Sidebar'
import { FloatingAdd } from '@/components/layout/FloatingAdd'
import { SyncProvider } from '@/components/layout/SyncProvider'
import { GlobalShortcuts } from '@/components/layout/GlobalShortcuts'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientOnly>
      <div className="flex h-full bg-[var(--bg-base)] group">
        <SyncProvider />
        <GlobalShortcuts />
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </div>
        <FloatingAdd />
      </div>
    </ClientOnly>
  )
}
