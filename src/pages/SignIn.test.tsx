// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  signInWithPassword: vi.fn(async (_a: unknown): Promise<{ error: { message: string } | null }> => ({ error: null })),
  sendResetLink: vi.fn(async (_e: string) => {}),
}))
vi.mock('../lib/supabase', () => ({
  client: () => ({ auth: { signInWithPassword: h.signInWithPassword, signInWithOtp: vi.fn(), signUp: vi.fn(), signInWithOAuth: vi.fn() } }),
  appUrl: (p = '') => `https://app.test/bhag/${p}`,
}))
vi.mock('../lib/providers', () => ({ googleEnabled: async () => false }))
vi.mock('../lib/password', () => ({ sendResetLink: h.sendResetLink }))

import SignIn from './SignIn'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

async function openPasswordMode(user: ReturnType<typeof userEvent.setup>) {
  render(<SignIn />)
  await user.click(screen.getByRole('button', { name: 'Password' }))
}

describe('Sign-in: forgot password', () => {
  it('asks for an email first', async () => {
    const user = userEvent.setup()
    await openPasswordMode(user)
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(await screen.findByText(/Enter your email above/)).toBeInTheDocument()
    expect(h.sendResetLink).not.toHaveBeenCalled()
  })

  it('sends the reset link and tells people to check their email', async () => {
    const user = userEvent.setup()
    await openPasswordMode(user)
    await user.type(screen.getByLabelText('Email'), 'meera@example.com')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    await waitFor(() => expect(h.sendResetLink).toHaveBeenCalledWith('meera@example.com'))
    expect(await screen.findByText(/If meera@example.com has an account, we sent a link to choose a new password/)).toBeInTheDocument()
  })

  it('shows an error if the email could not be sent', async () => {
    h.sendResetLink.mockRejectedValueOnce(new Error('Too many requests. Wait a minute and try again.'))
    const user = userEvent.setup()
    await openPasswordMode(user)
    await user.type(screen.getByLabelText('Email'), 'meera@example.com')
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument()
  })

  it('is not offered when creating an account', async () => {
    const user = userEvent.setup()
    await openPasswordMode(user)
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull()
  })

  it('lets an older, shorter password through to Supabase when signing in', async () => {
    const user = userEvent.setup()
    await openPasswordMode(user)
    await user.type(screen.getByLabelText('Email'), 'meera@example.com')
    await user.type(screen.getByLabelText('Password'), 'abc123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(h.signInWithPassword).toHaveBeenCalledWith({ email: 'meera@example.com', password: 'abc123' }))
  })
})
