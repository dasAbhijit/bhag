import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  updateUser: vi.fn(async (_a: unknown): Promise<{ error: { message: string } | null }> => ({ error: null })),
  resetPasswordForEmail: vi.fn(async (_e: string, _o: unknown): Promise<{ error: { message: string } | null }> => ({ error: null })),
}))
vi.mock('./supabase', () => ({
  client: () => ({ auth }),
  appUrl: (p = '') => `https://dasabhijit.github.io/bhag/${p}`,
}))

import { changePassword, friendlyAuthError, passwordProblem, sendResetLink } from './password'

beforeEach(() => vi.clearAllMocks())

describe('password rules', () => {
  it('needs 8 characters and a matching confirmation', () => {
    expect(passwordProblem('short', 'short')).toMatch(/at least 8/)
    expect(passwordProblem('longenough', 'different1')).toMatch(/do not match/)
    expect(passwordProblem('longenough', 'longenough')).toBeNull()
  })

  it('explains the errors people can actually hit', () => {
    expect(friendlyAuthError('New password should be different from the old password.')).toMatch(/not used on this account/)
    expect(friendlyAuthError('Password update requires reauthentication')).toMatch(/Email me a reset link/)
    expect(friendlyAuthError('For security purposes, you can only request this after 52 seconds.')).toMatch(/Too many requests/)
    expect(friendlyAuthError('Auth session missing!')).toMatch(/expired/)
    expect(friendlyAuthError('Something else')).toBe('Something else')
  })
})

describe('talking to Supabase', () => {
  it('changes the password of the signed-in person', async () => {
    await changePassword('a-new-password')
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a-new-password' })
  })

  it('surfaces a readable error when the change is refused', async () => {
    auth.updateUser.mockResolvedValueOnce({ error: { message: 'New password should be different from the old password.' } })
    await expect(changePassword('same-as-before')).rejects.toThrow(/not used on this account/)
  })

  it('emails a reset link that comes back to the reset page', async () => {
    await sendResetLink('  meera@example.com ')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('meera@example.com', { redirectTo: 'https://dasabhijit.github.io/bhag/reset-password' })
  })
})
