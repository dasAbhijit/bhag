import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatINR } from '../core/money'
import { deleteRecurring, setRecurringActive } from '../data/api'
import { useLedger } from '../data/hooks'
import type { RecurringTemplate } from '../data/types'
import { useRun } from '../ui/toast'
import { categoryLabel, ConfirmSheet, Empty, fmtDate, Spinner } from '../ui/ui'

const FREQ = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' }

export default function Recurring() {
  const { id = '' } = useParams()
  const { data, views, isLoading } = useLedger()
  const run = useRun()
  const [removing, setRemoving] = useState<RecurringTemplate | null>(null)
  const view = views.find((v) => v.group.id === id)
  if (isLoading) return <Spinner />
  if (!view || !data) return <main className="page"><Link className="btn" to="/">Back</Link></main>
  const items = data.recurring.filter((r) => r.group_id === id)

  return (
    <main className="page">
      <div className="page-head">
        <Link to={`/groups/${id}?tab=people`} className="back">‹ Back</Link>
        <h1>Repeating expenses</h1>
      </div>
      <p className="muted small">Each one adds a new expense on its date, split the same way as the first. To set one up, add an expense and choose Repeat.</p>
      {items.length === 0 ? (
        <div className="card"><Empty title="Nothing repeats yet">Rent, bills and subscriptions are good candidates.</Empty></div>
      ) : (
        <ul className="card list">
          {items.map((r) => (
            <li key={r.id} className="row">
              <div className="grow">
                <div className="title">{r.title}</div>
                <div className="muted small">{FREQ[r.frequency]} · {categoryLabel(r.category)}</div>
                <div className="muted small">{r.active ? `Next: ${fmtDate(r.next_run)}` : 'Paused'}{r.end_date ? ` · until ${fmtDate(r.end_date)}` : ''}</div>
              </div>
              <div className="row-end">
                <div className="money">{formatINR(r.amount_paise)}</div>
                <div className="actions" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn sm" onClick={() => run(() => setRecurringActive(r.id, !r.active), r.active ? 'Paused' : 'Resumed')}>{r.active ? 'Pause' : 'Resume'}</button>
                  <button className="btn ghost danger sm" onClick={() => setRemoving(r)}>Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <ConfirmSheet
          title="Delete this schedule?" confirmLabel="Delete schedule" danger onClose={() => setRemoving(null)}
          onConfirm={async () => { await run(() => deleteRecurring(removing.id), 'Schedule deleted'); setRemoving(null) }}
        >
          No more “{removing.title}” expenses will be added. Ones already added stay.
        </ConfirmSheet>
      )}
    </main>
  )
}
