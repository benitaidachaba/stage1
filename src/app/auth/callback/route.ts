import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * The auth callback. Supabase redirects here with a one-time code; this
 * exchanges it for a session and sends the person back to the app. When
 * Supabase is not configured the route simply sends people home.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.redirect(origin);
  }

  if (code) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
          }
        },
      },
    });
    // The exchange sets cookies on a mutable response below.
    const response = NextResponse.redirect(origin);
    const mutable = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });
    const { error } = await mutable.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/?auth=failed`);
    void supabase;
    return response;
  }

  return NextResponse.redirect(`${origin}/?auth=missing-code`);
}
