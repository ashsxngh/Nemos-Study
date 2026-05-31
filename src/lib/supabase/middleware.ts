import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function isConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !!(url && key && url.startsWith('https://') && !url.includes('your_supabase'))
}

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({ request })

  // If Supabase isn't configured yet, pass through with no user
  if (!isConfigured()) {
    return { supabaseResponse, user: null, configured: false }
  }

  let response = supabaseResponse
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  try {
    const { data: { user } } = await supabase.auth.getUser()
    return { supabaseResponse: response, user, configured: true }
  } catch {
    return { supabaseResponse: response, user: null, configured: true }
  }
}
