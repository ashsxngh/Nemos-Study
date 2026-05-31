import { Header } from '@/components/layout/Header'
import { StatsPage } from '@/components/stats/StatsPage'
import { Button } from '@/components/ui/Button'
import { Download } from 'lucide-react'

export default function StatsRoute() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Stats & Analytics"
        actions={
          <Button variant="ghost" size="sm" icon={<Download size={13} />}>Export</Button>
        }
      />
      <main className="flex-1 overflow-y-auto p-5">
        <StatsPage />
      </main>
    </div>
  )
}
