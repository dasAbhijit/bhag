import { useState, type FormEvent } from 'react'
import { formatINR, parseINR } from '../../core/money'
import type { Transfer } from '../../core/types'
import { saveSettlement } from '../../data/api'
import type { GroupView } from '../../data/ledger'
import { useRun } from '../../ui/toast'
import { Avatar, ErrorNote, Field, Money, Sheet, todayISO } from '../../ui/ui'

export default function BalancesTab({ view }: { view: GroupView }) {
  const [settle, setSettle] = useState<Partial<Transfer> | null>(null)
  const name = (id: string) => view.memberById.get(id)?.display_name ?? 'Someone'
  const people = view.members.map((m) => ({ m, net: view.net[m.id] ?? 0 })).sort((a, b) => b.net - a.net)
  const settled = view.suggestions.length === 0

  return (
    <>
      <div className="section-title"><h2>Balances</h2></div>
      <ul className="card list">
        {people.map(({ m, net }) => (
          <li key={m.id} className="row">
            <Avatar name={m.display_name} />
            <div className="grow title">
              {m.display_name}
              {m.id === view.me?.id && <span className="pill" style={{ marginLeft: 6 }}>you</span>}
            </div>
            <Money paise={net} signed />
          </li>
        ))}
      </ul>

      <div className="section-title">
        <h2>Settle up</h2>
        <button className="btn sm" onClick={() => setSettle({})}>Record a payment</button>
      </div>
      {settled ? (
        <div className="card card-pad"><strong>Everyone is settled up.</strong></div>
      ) : (
        <ul className="card list">
          {view.suggestions.map((t) => (
            <li key={t.from + t.to} className="row">
              <div className="grow">
                <div className="muted small">{name(t.from)} pays {name(t.to)}</div>
                <Money paise={t.amount} />
              </div>
              <button className="btn sm" onClick={() => setSettle(t)}>Settle</button>
            </li>
          ))}
        </ul>
      )}
      <div className="note info small">
        {view.group.simplify_debts
          ? `Simplify debts is on. ${view.suggestions.length} ${view.suggestions.length === 1 ? 'payment settles' : 'payments settle'} the whole group. You can turn it off in People.`
          : 'Simplify debts is off. These are the direct amounts people owe each other.'}
      </div>
      {settle && <SettleSheet view={view} initial={settle} onClose={() => setSettle(null)} />}
    </>
  )
}

function SettleSheet({ view, initial, onClose }: { view: GroupView; initial: Partial<Transfer>; onClose: () => void }) {
  const run = useRun()
  const me = view.me?.id
  const [from, setFrom] = useState(initial.from ?? me ?? view.members[0]?.id ?? '')
  const [to, setTo] = useState(initial.to ?? view.members.find((m) => m.id !== (initial.from ?? me))?.id ?? '')
  const [amount, setAmount] = useState(initial.amount ? (initial.amount / 100).toFixed(2) : '')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const paise = parseINR(amount)
    if (!paise || paise <= 0) return setError('Enter an amount in rupees, like 500 or 499.50')
    if (from === to) return setError('Choose two different people')
    setError(null)
    setBusy(true)
    const ok = await run(() => saveSettlement({ group_id: view.group.id, from_member: from, to_member: to, amount_paise: paise, settled_on: date, note: note.trim() || undefined }), `Recorded ${formatINR(paise)}`)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Sheet title="Record a payment" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid2">
          <Field label="Who paid">
            <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
              {view.members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
          </Field>
          <Field label="Paid to">
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              {view.members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid2">
          <Field label="Amount (₹)">
            <input className="input money-in" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
          </Field>
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="UPI, cash…" />
        </Field>
        <ErrorNote error={error} />
        <button className="btn primary" disabled={busy}>Record payment</button>
      </form>
    </Sheet>
  )
}
