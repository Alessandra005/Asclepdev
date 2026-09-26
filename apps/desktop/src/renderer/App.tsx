import { useCallback, useEffect } from 'react'
import { Spinner } from '@blueprintjs/core'
import { useQueryClient } from '@tanstack/react-query'
import { configureClient } from '@/api/client'
import { useMe } from '@/api/hooks'
import { AppShell } from '@/components/AppShell'
import { ErrorCallout } from '@/components/QueryState'
import { useSession } from '@/state/session'
import { useUi, type TabId } from '@/state/ui'
import { AdminTab } from '@/tabs/admin/AdminTab'
import { AskTab } from '@/tabs/ask/AskTab'
import { AuditTab } from '@/tabs/audit/AuditTab'
import { DashboardTab } from '@/tabs/dashboard/DashboardTab'
import { LabTab } from '@/tabs/lab/LabTab'
import { LoginScreen } from '@/tabs/login/LoginScreen'
import { PatientTab } from '@/tabs/patient/PatientTab'
import { RecordsTab } from '@/tabs/records/RecordsTab'

const TABS: Record<TabId, () => JSX.Element> = {
  dashboard: DashboardTab,
  ask: AskTab,
  patient: PatientTab,
  lab: LabTab,
  records: RecordsTab,
  audit: AuditTab,
  admin: AdminTab
}

export function App() {
  const qc = useQueryClient()
  const token = useSession((s) => s.token)
  const role = useSession((s) => s.role)
  const setMe = useSession((s) => s.setMe)
  const activeTab = useUi((s) => s.activeTab)
  const setTab = useUi((s) => s.setTab)

  // Logout (or any 401) clears session, UI selection and every cached clinical record.
  const signOut = useCallback(() => {
    useSession.getState().signOut()
    useUi.getState().reset()
    qc.clear()
  }, [qc])

  useEffect(() => {
    configureClient({ getToken: () => useSession.getState().token, onUnauthorized: signOut })
  }, [signOut])

  const me = useMe(!!token)
  useEffect(() => {
    if (!me.data) return
    setMe(me.data.role, me.data.permissions)
    // Role-specific landing (spec 16 / kickoff p.2): clinicians -> Dashboard, admin -> Audit, lab -> Lab.
    const landing: TabId =
      me.data.role === 'admin' ? 'audit' : me.data.role === 'lab_staff' ? 'lab' : 'dashboard'
    setTab(landing)
  }, [me.data, setMe, setTab])

  if (!token) return <LoginScreen />
  if (me.isPending || !role)
    return (
      <div className="state-center full">
        <Spinner />
      </div>
    )
  if (me.isError)
    return (
      <div className="state-center full">
        <ErrorCallout error={me.error} onRetry={() => void me.refetch()} />
      </div>
    )

  const Tab = TABS[activeTab]
  return (
    <AppShell onSignOut={signOut}>
      <Tab />
    </AppShell>
  )
}
