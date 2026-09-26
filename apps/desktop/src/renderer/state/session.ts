import { create } from 'zustand'
import type { Permission, Role, User } from '@/api/types'

interface SessionState {
  token: string | null
  user: User | null
  role: Role | null
  permissions: Permission[]
  signIn: (token: string, user: User) => void
  setMe: (role: Role, permissions: Permission[]) => void
  signOut: () => void
  can: (p: Permission) => boolean
}

/** Memory only on purpose: nothing clinical or auth-related touches disk. Reload = sign in again. */
export const useSession = create<SessionState>((set, get) => ({
  token: null,
  user: null,
  role: null,
  permissions: [],
  signIn: (token, user) => set({ token, user, role: user.role }),
  setMe: (role, permissions) => set({ role, permissions }),
  signOut: () => set({ token: null, user: null, role: null, permissions: [] }),
  can: (p) => get().permissions.includes(p)
}))
