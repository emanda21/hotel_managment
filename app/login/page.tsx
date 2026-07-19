/**
 * app/login/page.tsx
 * ------------------
 * Daris Hotel — /login is obsolete.
 * The /admin page handles its own username + password authentication.
 *
 * This is a Server Component that issues a permanent server-side redirect
 * to /admin so Next.js can statically prerender it without any issues.
 * No 'use client', no useSearchParams, no Suspense needed.
 */
import { redirect } from 'next/navigation'

export default function LoginPage() {
  redirect('/admin')
}
