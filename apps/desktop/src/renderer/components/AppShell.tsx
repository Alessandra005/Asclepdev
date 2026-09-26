import { useEffect, type ReactNode } from 'react'
import {
  Button,
  Classes,
  Icon,
  Menu,
  MenuDivider,
  MenuItem,
  Popover,
  Tag,
  Tooltip,
  type IconName
} from '@blueprintjs/core'
import { useSession } from '@/state/session'
import { useUi, type TabId } from '@/state/ui'
import { USE_MOCKS } from '@/api/client'
import { PatientSearch } from './PatientSearch'
import { SourceDrawer } from './SourceDrawer'

interface NavItem {
  id: TabId
  label: string
  icon: IconName
  show: (role: string | null) => boolean
}
const CLINICAL = (r: string | null) => r === 'physician' || r === 'nurse'
const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', show: CLINICAL },
  { id: 'ask', label: 'Ask', icon: 'chat', show: CLINICAL },
  { id: 'patient', label: 'Patient', icon: 'person', show: (r) => r !== 'admin' },
  { id: 'lab', label: 'Lab', icon: 'lab-test', show: (r) => r !== 'admin' },
  { id: 'records', label: 'Records', icon: 'folder-close', show: CLINICAL }
]
const NAV_BOTTOM: NavItem[] = [
  { id: 'audit', label: 'Audit', icon: 'history', show: () => true },
  { id: 'admin', label: 'Admin', icon: 'cog', show: (r) => r === 'admin' }
]

export function AppShell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const { user, role } = useSession()
  const { activeTab, setTab, theme, toggleTheme, navCollapsed, toggleNav, setSearchOpen } = useUi()
  const visible = [...NAV, ...NAV_BOTTOM].filter((n) => n.show(role))

  // Spec 14.5: Ctrl+1..Ctrl+5 switch tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const n = Number(e.key)
      const target = visible[n - 1]
      if (n >= 1 && n <= 5 && target) {
        e.preventDefault()
        setTab(target.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, setTab])

  const renderItem = (n: NavItem) => {
    const item = (
      <MenuItem
        key={n.id}
        icon={<Icon icon={n.icon} />}
        text={navCollapsed ? undefined : n.label}
        active={activeTab === n.id}
        onClick={() => setTab(n.id)}
        aria-label={n.label}
      />
    )
    return navCollapsed ? (
      <Tooltip key={n.id} content={n.label} placement="right">
        {item}
      </Tooltip>
    ) : (
      item
    )
  }

  return (
    <div className={`app ${theme === 'dark' ? Classes.DARK : ''}`}>
      <aside className={`nav ${navCollapsed ? 'is-collapsed' : ''} ${Classes.DARK}`}>
        <div className="brand">
          <Icon icon="pulse" size={18} />
          {!navCollapsed && <span>Asclep</span>}
        </div>
        <Menu className="nav-menu">
          {NAV.filter((n) => n.show(role)).map(renderItem)}
          <MenuDivider />
          {NAV_BOTTOM.filter((n) => n.show(role)).map(renderItem)}
        </Menu>
        <div className="nav-foot">
          {!navCollapsed && <div className="small muted">{user?.role.replace('_', ' ')}</div>}
          {USE_MOCKS && !navCollapsed && <div className="mono tiny muted">SYNTHETIC DEMO · MOCK API</div>}
          <Button
            variant="minimal"
            size="small"
            icon={navCollapsed ? 'chevron-right' : 'chevron-left'}
            onClick={toggleNav}
            aria-label="Toggle navigation"
          />
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Button
            className="search-trigger"
            variant="outlined"
            alignText="start"
            icon="search"
            text="Search patients..."
            endIcon={<span className="kbd">Ctrl / Cmd + K</span>}
            onClick={() => setSearchOpen(true)}
          />
          <span className="spacer" />
          <Tag minimal round icon="shield" intent="success">
            Local-first · every AI step audited
          </Tag>
          <Button variant="minimal" icon="notifications" aria-label="Alerts" />
          <Popover
            placement="bottom-end"
            content={
              <Menu>
                <MenuItem
                  icon={theme === 'light' ? 'moon' : 'flash'}
                  text={theme === 'light' ? 'Dark theme' : 'Light theme'}
                  onClick={toggleTheme}
                />
                <MenuDivider />
                <MenuItem icon="log-out" text="Sign out" onClick={onSignOut} />
              </Menu>
            }
          >
            <Button variant="minimal" endIcon="caret-down" text={user?.full_name} />
          </Popover>
        </header>
        <main className="content">{children}</main>
      </div>
      <PatientSearch />
      <SourceDrawer />
    </div>
  )
}
