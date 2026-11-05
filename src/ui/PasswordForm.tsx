import { useState, type FormEvent } from 'react'
import { changePassword, MIN_PASSWORD, passwordProblem } from '../lib/password'
import { ErrorNote, Field } from './ui'

/** Choose a new password. Used in Account and on the page the reset email opens. */
export default function PasswordForm({ submitLabel = 'Change password', onDone }: { submitLabel?: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = passwordProblem(password, confirm)
    if (problem) return setError(problem)
    setError(null)
    setBusy(true)
    try {
      await changePassword(password)
      setPassword('')
      setConfirm('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Field label="New password" hint={`At least ${MIN_PASSWORD} characters`}>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password">
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      <ErrorNote error={error} />
      <button className="btn primary" disabled={busy || !password || !confirm}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
