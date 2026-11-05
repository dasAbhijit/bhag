// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pw = vi.hoisted(() => ({ changePassword: vi.fn(async (_p: string) => {}) }))
vi.mock('../lib/password', async () => {
  const real = await vi.importActual<typeof import('../lib/password')>('../lib/password')
  return { ...real, changePassword: pw.changePassword }
})

import PasswordForm from './PasswordForm'

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

async function fill(user: ReturnType<typeof userEvent.setup>, a: string, b: string) {
  await user.type(screen.getByLabelText(/^New password/), a)
  await user.type(screen.getByLabelText('Confirm new password'), b)
}

describe('PasswordForm', () => {
  it('does nothing until both fields are filled', () => {
    render(<PasswordForm onDone={() => {}} />)
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
  })

  it('rejects a short password and a mismatch without calling Supabase', async () => {
    const user = userEvent.setup()
    render(<PasswordForm onDone={() => {}} />)
    await fill(user, 'short', 'short')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/^New password/))
    await user.clear(screen.getByLabelText('Confirm new password'))
    await fill(user, 'long-enough-1', 'long-enough-2')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument()
    expect(pw.changePassword).not.toHaveBeenCalled()
  })

  it('saves a good password, then reports done', async () => {
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<PasswordForm submitLabel="Save new password" onDone={onDone} />)
    await fill(user, 'long-enough-1', 'long-enough-1')
    await user.click(screen.getByRole('button', { name: 'Save new password' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(pw.changePassword).toHaveBeenCalledWith('long-enough-1')
  })

  it('shows Supabase refusing and does not report done', async () => {
    pw.changePassword.mockRejectedValueOnce(new Error('Choose a password you have not used on this account before.'))
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<PasswordForm onDone={onDone} />)
    await fill(user, 'long-enough-1', 'long-enough-1')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText(/not used on this account/)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
