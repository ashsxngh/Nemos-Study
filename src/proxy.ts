import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user, configured } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPublicAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/manifest') ||
    pathname === '/favicon.ico'

  if (isPublicAsset) return supabaseResponse

  // Supabase not configured yet — let everyone through (local-only mode)
  if (!configured) return supabaseResponse

  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/signup')
  // Always public, regardless of auth state — /reset-password specifically
  // must stay reachable even after the recovery link's code-exchange lands a
  // session, or a mid-flow refresh would get redirected to "/" before the
  // user can set their new password.
  const isPasswordResetFlow = pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password')

  if (!user && !isAuthPage && !isPasswordResetFlow) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    return NextResponse.redirect(loginUrl)
  }

  if (user && isAuthPage) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = '/'
    return NextResponse.redirect(homeUrl)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
