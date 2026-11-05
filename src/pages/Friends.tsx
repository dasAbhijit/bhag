import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLedger } from '../data/hooks'
import { Avatar, Empty, ErrorNote, Money, Spinner } from '../ui/ui'

export default function Friends() {
  const { friends, isLoading, error } = useLedger()
  const [open, setOpen] = useState<string | null>(null)

  return (
    <main className="page">
      <div className="page-head">
        <h1>Friends</h1>
      </div>
      <p className="muted small">Your balance with each person, added up across every group you share.</p>
      <ErrorNote error={error} />
      {isLoading ? (
        <Spinner />
      ) : friends.length === 0 ? (
        <div className="card">
          <Empty title="Everyone is settled up">Balances with friends show up here once you add expenses.</Empty>
        </div>
      ) : (
        <ul className="card list">
          {friends.map((f) => (
            <li key={f.key}>
              <button
                className="row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
                aria-expanded={open === f.key} onClick={() => setOpen(open === f.key ? null : f.key)}
              >
                <Avatar name={f.name} />
                <div className="grow">
                  <div className="title">{f.name}</div>
                  <div className="muted small">{f.total > 0 ? 'owes you' : 'you owe'} · {f.groups.length} {f.groups.length === 1 ? 'group' : 'groups'}</div>
                </div>
                <Money paise={f.total} signed />
              </button>
              {open === f.key && (
                <ul className="list" style={{ background: 'var(--surface-2)' }}>
                  {f.groups.map((g) => (
                    <li key={g.group.id}>
                      <Link className="row" to={`/groups/${g.group.id}`}>
                        <div className="grow small">{g.group.name}</div>
                        <Money paise={g.amount} signed />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
