import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createGroup } from '../data/api'
import { useLedger } from '../data/hooks'
import { totals, type GroupView } from '../data/ledger'
import { useRun } from '../ui/toast'
import { Avatar, Empty, ErrorNote, Field, Money, Sheet, Spinner } from '../ui/ui'

function BalanceText({ paise }: { paise: number }) {
  if (paise === 0) return <span className="muted small">settled up</span>
  return (
    <div>
      <div className="small muted">{paise > 0 ? 'you are owed' : 'you owe'}</div>
      <Money paise={Math.abs(paise)} className={paise > 0 ? 'pos' : 'neg'} />
    </div>
  )
}

function GroupRow({ v }: { v: GroupView }) {
  const others = v.members.filter((m) => m.id !== v.me?.id).map((m) => m.display_name)
  return (
    <li>
      <Link to={`/groups/${v.group.id}`} className="row">
        <Avatar name={v.group.name} />
        <div className="grow">
          <div className="title">{v.group.name}</div>
          <div className="muted small">{v.group.is_direct ? 'One-on-one' : `${v.members.length} people`}{others.length > 0 && !v.group.is_direct ? ` · ${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}` : ''}</div>
        </div>
        <div className="row-end">
          <BalanceText paise={v.myNet} />
        </div>
      </Link>
    </li>
  )
}

export default function Dashboard() {
  const { views, isLoading, error } = useLedger()
  const [creating, setCreating] = useState<'group' | 'friend' | null>(null)
  const { owed, owe } = totals(views)
  const groups = views.filter((v) => !v.group.is_direct)
  const direct = views.filter((v) => v.group.is_direct)

  return (
    <main className="page">
      <div className="page-head">
        <h1>Your balances</h1>
        <div className="actions">
          <button className="btn sm" onClick={() => setCreating('friend')}>
            + Friend
          </button>
          <button className="btn primary sm" onClick={() => setCreating('group')}>
            + Group
          </button>
        </div>
      </div>

      <ErrorNote error={error} />
      {isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="card summary">
            <div>
              <div className="muted small">You are owed</div>
              <div className="big"><Money paise={owed} className={owed > 0 ? 'pos' : 'zero'} /></div>
            </div>
            <div>
              <div className="muted small">You owe</div>
              <div className="big"><Money paise={owe} className={owe > 0 ? 'neg' : 'zero'} /></div>
            </div>
          </div>

          <div className="section-title"><h2>Groups</h2></div>
          {groups.length === 0 ? (
            <div className="card">
              <Empty title="No groups yet">Create one for a trip, a flat or a regular dinner, then invite people with a link.</Empty>
            </div>
          ) : (
            <ul className="card list">{groups.map((v) => <GroupRow key={v.group.id} v={v} />)}</ul>
          )}

          <div className="section-title"><h2>One-on-one</h2></div>
          {direct.length === 0 ? (
            <div className="card">
              <Empty title="No one-on-one balances">Add a friend to keep a running tab between the two of you.</Empty>
            </div>
          ) : (
            <ul className="card list">{direct.map((v) => <GroupRow key={v.group.id} v={v} />)}</ul>
          )}
        </>
      )}
      {creating && <CreateSheet kind={creating} onClose={() => setCreating(null)} />}
    </main>
  )
}

function CreateSheet({ kind, onClose }: { kind: 'group' | 'friend'; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const run = useRun()
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const id = await run(() => (kind === 'group' ? createGroup(name.trim()) : createGroup(name.trim(), true, name.trim())))
    setBusy(false)
    if (id) {
      onClose()
      navigate(`/groups/${id}`)
    }
  }

  return (
    <Sheet title={kind === 'group' ? 'New group' : 'Add a friend'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field
          label={kind === 'group' ? 'Group name' : "Friend's name"}
          hint={kind === 'group' ? 'For example: Goa trip, Flat 4B, Sunday dinners' : 'You can send them an invite link so they can see the same tab.'}
        >
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </Field>
        <button className="btn primary" disabled={busy || !name.trim()}>
          {kind === 'group' ? 'Create group' : 'Add friend'}
        </button>
      </form>
    </Sheet>
  )
}
