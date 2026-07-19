/**
 * hooks/useRole.ts
 * ----------------
 * Returns the current Supabase Auth user and their role from the profiles table.
 *
 * Usage:
 *   const { user, role, loading } = useRole()
 *   if (role === 'admin') { ... }
 */

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

export type Role = 'admin' | 'staff' | null

export interface UseRoleResult {
  user:    User | null
  role:    Role
  loading: boolean
  signOut: () => Promise<void>
}

export function useRole(): UseRoleResult {
  const [user,    setUser]    = useState<User | null>(null)
  const [role,    setRole]    = useState<Role>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // ── Initial session load ────────────────────────────────────────────
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        setUser(session.user)
        await fetchRole(session.user.id)
      }
      setLoading(false)
    }

    // ── Fetch role from profiles table ──────────────────────────────────
    async function fetchRole(userId: string) {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single()

      setRole((data?.role as Role) ?? 'staff')
    }

    init()

    // ── Subscribe to auth state changes (login / logout) ───────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          setUser(session.user)
          await fetchRole(session.user.id)
        } else {
          setUser(null)
          setRole(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  return { user, role, loading, signOut }
}
