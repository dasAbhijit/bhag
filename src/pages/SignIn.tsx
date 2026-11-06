import { useEffect, useState, type FormEvent } from 'react'
import { appUrl, client } from '../lib/supabase'
import { sendResetLink } from '../lib/password'
import { googleEnabled } from '../lib/providers'
import { ErrorNote, Field } from '../ui/ui'

type Mode = 'link' | 'password'

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<false | 'signin' | 'reset'>(false)
  const [hasGoogle, setHasGoogle] = useState(false)

  useEffect(() => {
    void googleEnabled().then(setHasGoogle)
  }, [])

  async function google() {
    setError(null)
    const { error } = await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: appUrl() } })
    if (error) setError(error.message)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const sb = client()
      if (mode === 'link') {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: appUrl() } })
        if (error) throw error
        setSent('signin')
      } else if (creating) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: appUrl() } })
        if (error) throw error
        if (!data.session) setSent('signin') // email confirmation is switched on
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    if (!email.trim()) return setError('Enter your email above, then tap Forgot password')
    setBusy(true)
    setError(null)
    try {
      await sendResetLink(email)
      setSent('reset')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <main className="auth">
        <h1>Bhag</h1>
        <div className="note info">
          <strong>Check your email.</strong>
          {sent === 'reset' ? (
            <p>If {email} has an account, we sent a link to choose a new password. Open it on this device.</p>
          ) : (
            <p>We sent a link to {email}. Open it on this device to finish signing in.</p>
          )}
        </div>
        <button className="btn" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </main>
    )
  }

  return (
    <main className="auth">
      <div>
        <h1>Bhag</h1>
        <p className="muted">Split bills with friends and family. Everything in ₹.</p>
      </div>
      {hasGoogle && (
        <>
          <button className="btn block" onClick={google}>
            Continue with Google
          </button>
          <div className="divider">or use your email</div>
        </>
      )}
      <div className="seg" role="group" aria-label="Sign-in method">
        <button type="button" aria-pressed={mode === 'password'} onClick={() => setMode('password')}>
          Password
        </button>
        <button type="button" aria-pressed={mode === 'link'} onClick={() => setMode('link')}>
          Email link
        </button>
      </div>
      <form className="stack" onSubmit={submit}>
        {mode === 'password' && creating && (
          <Field label="Your name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Field>
        )}
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        {mode === 'password' && (
          <Field label="Password" hint={creating ? 'At least 8 characters' : undefined}>
            <input
              className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={creating ? 8 : undefined} required
              autoComplete={creating ? 'new-password' : 'current-password'}
            />
          </Field>
        )}
        {mode === 'link' && <p className="muted">Needs an email to arrive, which can be slow. A password signs you in straight away.</p>}
        <ErrorNote error={error} />
        <button className="btn primary block" disabled={busy}>
          {mode === 'link' ? 'Email me a sign-in link' : creating ? 'Create account' : 'Sign in'}
        </button>
        {mode === 'password' && (
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn ghost" onClick={() => setCreating((c) => !c)}>
              {creating ? 'I already have an account' : 'Create an account'}
            </button>
            {!creating && (
              <button type="button" className="btn ghost" onClick={() => void forgot()} disabled={busy}>
                Forgot password?
              </button>
            )}
          </div>
        )}
      </form>
    </main>
  )
}
