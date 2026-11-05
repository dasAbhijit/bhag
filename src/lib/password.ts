import { appUrl, client } from './supabase'

export const MIN_PASSWORD = 8

/** Make the messages people can actually hit readable and tell them what to do next. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('different from the old password') || (m.includes('same') && m.includes('password'))) return 'Choose a password you have not used on this account before.'
  if (m.includes('reauth')) {
    return 'For safety, please confirm it is you. Use “Email me a reset link” and set the new password from the email.'
  }
  if (m.includes('rate limit') || m.includes('security purposes')) return 'Too many requests. Wait a minute and try again.'
  if (m.includes('session') && m.includes('missing')) return 'Your sign-in has expired. Sign in again, then try once more.'
  return message
}

/** Why a new password is not acceptable, or null if it is fine. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`
  if (password !== confirm) return 'The two passwords do not match'
  return null
}

/** Set a new password for the signed-in person. Also works for people who signed in by email link or Google. */
export async function changePassword(password: string): Promise<void> {
  const { error } = await client().auth.updateUser({ password })
  if (error) throw new Error(friendlyAuthError(error.message))
}

/** Email a link that lets someone choose a new password. Does not reveal whether the email has an account. */
export async function sendResetLink(email: string): Promise<void> {
  const { error } = await client().auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('reset-password') })
  if (error) throw new Error(friendlyAuthError(error.message))
}
