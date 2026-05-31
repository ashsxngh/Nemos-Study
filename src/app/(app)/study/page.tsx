import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { StudyHub } from '@/components/study/StudyHub'
import { Button } from '@/components/ui/Button'
import { Play, Shuffle, AlertCircle } from 'lucide-react'

export default function StudyPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Study"
        actions={
          <>
            <Link href="/study/session?mode=failed">
              <Button variant="ghost" size="sm" icon={<AlertCircle size={13} />}>Overdue Only</Button>
            </Link>
            <Link href="/study/session?mode=random">
              <Button variant="ghost" size="sm" icon={<Shuffle size={13} />}>Random</Button>
            </Link>
            <Link href="/study/session">
              <Button variant="primary" size="sm" icon={<Play size={12} />}>Start Review</Button>
            </Link>
          </>
        }
      />
      <main className="flex-1 overflow-y-auto p-5">
        <StudyHub />
      </main>
    </div>
  )
}
