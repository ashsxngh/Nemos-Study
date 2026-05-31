'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { PlannerPage } from '@/components/planner/PlannerPage'
import { Button } from '@/components/ui/Button'
import { Plus } from 'lucide-react'

export default function PlannerRoute() {
  const [addingExam, setAddingExam] = useState(false)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Planner"
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddingExam(true)}>
            Add Exam
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto p-5">
        <PlannerPage addingExam={addingExam} onExamAdded={() => setAddingExam(false)} />
      </main>
    </div>
  )
}
