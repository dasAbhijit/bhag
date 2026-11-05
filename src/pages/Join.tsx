import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getInvitePreview, joinGroup } from '../data/api'
import type { InvitePreview } from '../data/types'
import { useRun } from '../ui/toast'
import { Avatar, ErrorNote, Spinner } from '../ui/ui'

export default function Join() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const run = useRun()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [claim, setClaim] = useState<string>('new')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    getInvitePreview(code)
      .then((p) => {
        if (!alive) return
        if (p.already_member) navigate(`/groups/${p.group_id}`, { replace: true })
        const open = p.members.filter((m) => !m.claimed)
        setClaim(p.is_direct && open.length === 1 ? open[0].id : 'new')
        setPreview(p)
      })
      .catch((e: Error) => alive && setError(e))
    return () => {
      alive = false
    }
  }, [code, navigate])

  async function join() {
    setBusy(true)
    const id = await run(() => joinGroup(code, claim === 'new' ? null : claim), 'You joined the group')
    setBusy(false)
    if (id) navigate(`/groups/${id}`, { replace: true })
  }

  if (error) {
    return (
      <main className="page">
        <ErrorNote error={error} />
        <Link to="/" className="btn">Go to your groups</Link>
      </main>
    )
  }
  if (!preview) return <Spinner />
  const open = preview.members.filter((m) => !m.claimed)

  return (
    <main className="page">
      <div className="card card-pad stack">
        <h1>Join “{preview.name}”</h1>
        <p className="muted">
          {preview.members.filter((m) => m.claimed).length} {preview.members.filter((m) => m.claimed).length === 1 ? 'person has' : 'people have'} joined so far.
        </p>
        {open.length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <legend className="label">Which one are you?</legend>
            {open.map((m) => (
              <label key={m.id} className="check">
                <input type="radio" name="who" checked={claim === m.id} onChange={() => setClaim(m.id)} />
                <Avatar name={m.name} size={28} /> {m.name}
              </label>
            ))}
            <label className="check">
              <input type="radio" name="who" checked={claim === 'new'} onChange={() => setClaim('new')} />
              None of these, I am someone new
            </label>
            <p className="hint">Choosing your name keeps the expenses already added for you.</p>
          </fieldset>
        )}
        <button className="btn primary" disabled={busy} onClick={join}>
          Join group
        </button>
      </div>
    </main>
  )
}
