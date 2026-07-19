'use client'
/**
 * app/login/page.tsx
 * ------------------
 * Daris Hotel — redirects to /admin.
 * The /admin page handles its own username + password authentication
 * via sessionStorage — no separate Supabase auth flow is needed here.
 */

// Opt out of static prerendering — useSearchParams() requires a runtime
// request context and cannot be called during Next.js static generation.
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirect     = searchParams.get('redirect') || '/admin'

  useEffect(() => {
    router.replace(redirect)
  }, [router, redirect])

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Montserrat', system-ui, sans-serif",
    }}>
      <p style={{ color: 'rgba(197,168,128,0.6)', fontSize: 13, letterSpacing: '0.1em' }}>
        Redirecting…
      </p>
    </div>
  )
}

