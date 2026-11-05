import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/auth'
import { loadProfileName, updateProfileName } from '../data/api'
import { useRun } from '../ui/toast'
import { Field } from '../ui/ui'

export default function Account() {
  const { user, signOut } = useAuth()
  const run = useRun()
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user) return
    loadProfileName(user.id)
      .then(setName)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [user])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (user) await run(() => updateProfileName(user.id, name.trim()), 'Name saved')
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Account</h1>
      </div>
      <form className="card card-pad stack" onSubmit={save}>
        <Field label="Your name" hint="Shown to people in groups you create or join from now on.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!loaded} maxLength={60} />
        </Field>
        <div className="muted small">Signed in as {user?.email}</div>
        <button className="btn primary" disabled={!loaded || !name.trim()}>
          Save name
        </button>
      </form>
      <div className="card card-pad stack">
        <h2>Install on your phone</h2>
        <p className="muted small">
          iPhone: open this page in Safari, tap Share, then Add to Home Screen. Android: open the browser menu and choose Install app.
        </p>
        <a href="https://github.com/dasAbhijit/bhag" target="_blank" rel="noreferrer">Source code and user guide</a>
      </div>
      <button className="btn" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  )
}
