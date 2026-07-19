/**
 * middleware.ts
 * -------------
 * Next.js Edge Middleware — runs on every request before the page renders.
 *
 * Rules:
 *   /admin/*   → passes through directly (admin page has its own username/password login)
 *   Everything else → pass through
 */

import { type NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  // All routes pass through freely.
  // The /admin page handles its own authentication with username + password.
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *   - _next/static  (built assets)
     *   - _next/image   (image optimisation)
     *   - favicon.ico
     *   - public files (images, fonts, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
