import { create } from 'zustand'

export type TabId = 'dashboard' | 'ask' | 'patient' | 'lab' | 'records' | 'audit' | 'admin'

interface UiState {
  activeTab: TabId
  selectedPatientId: string | null
  theme: 'light' | 'dark'
  navCollapsed: boolean
  searchOpen: boolean
  sourceCitationId: string | null
  setTab: (t: TabId) => void
  openPatient: (id: string, tab?: TabId) => void
  toggleTheme: () => void
  toggleNav: () => void
  setSearchOpen: (open: boolean) => void
  openSource: (citationId: string | null) => void
  reset: () => void
}

const initial = {
  activeTab: 'dashboard' as TabId,
  selectedPatientId: null,
  navCollapsed: false,
  searchOpen: false,
  sourceCitationId: null
}

export const useUi = create<UiState>((set) => ({
  ...initial,
  theme: 'light',
  setTab: (activeTab) => set({ activeTab }),
  openPatient: (selectedPatientId, activeTab = 'patient') =>
    set({ selectedPatientId, activeTab, searchOpen: false }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'light' ? 'dark' : 'light' })),
  toggleNav: () => set((s) => ({ navCollapsed: !s.navCollapsed })),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  openSource: (sourceCitationId) => set({ sourceCitationId }),
  reset: () => set(initial)
}))
