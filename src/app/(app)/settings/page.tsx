import { Header } from '@/components/layout/Header'
import { SettingsPage } from '@/components/settings/SettingsPage'

export default function SettingsRoute() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title="Settings" />
      <main className="flex-1 overflow-y-auto p-5">
        <SettingsPage />
      </main>
    </div>
  )
}
