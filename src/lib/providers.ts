/** Whether Google sign-in is switched on in Supabase, so the button only shows when it will work. */
export async function googleEnabled(): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !key) return false
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    if (!res.ok) return false
    const data = (await res.json()) as { external?: { google?: boolean } }
    return data.external?.google === true
  } catch {
    return false
  }
}
