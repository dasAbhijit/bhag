import { useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteSettlement } from '../../data/api'
import type { GroupView } from '../../data/ledger'
import type { Expense, Settlement } from '../../data/types'
import { useRun } from '../../ui/toast'
import { ConfirmSheet, Empty, fmtDate, Money } from '../../ui/ui'
import { formatINR } from '../../core/money'

type Item = { kind: 'expense'; date: string; sort: string; e: Expense } | { kind: 'payment'; date: string; sort: string; s: Settlement }

export default function ExpensesTab({ view }: { view: GroupView }) {
  const run = useRun()
  const [removing, setRemoving] = useState<Settlement | null>(null)
  const name = (id: string) => view.memberById.get(id)?.display_name ?? 'Someone'

  const items: Item[] = [
    ...view.expenses.map((e): Item => ({ kind: 'expense', date: e.expense_date, sort: e.expense_date + e.created_at, e })),
    ...view.settlements.map((s): Item => ({ kind: 'payment', date: s.settled_on, sort: s.settled_on + s.created_at, s })),
  ].sort((a, b) => (a.sort < b.sort ? 1 : -1))

  function effect(e: Expense) {
    if (!view.me) return null
    const paid = e.expense_payers.find((p) => p.member_id === view.me!.id)?.paid_paise ?? 0
    const owed = e.expense_splits.find((p) => p.member_id === view.me!.id)?.owed_paise ?? 0
    const net = paid - owed
    if (net > 0) return <div className="small money pos">you lent {formatINR(net)}</div>
    if (net < 0) return <div className="small money neg">you owe {formatINR(-net)}</div>
    return <div className="small muted">not involved</div>
  }

  const paidBy = (e: Expense) =>
    e.expense_payers.length === 1 ? `${name(e.expense_payers[0].member_id)} paid` : `${e.expense_payers.length} people paid`

  return (
    <>
      <div className="actions sticky-actions">
        <Link className="btn primary" to={`/groups/${view.group.id}/expense/new`}>
          + Add expense
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="card">
          <Empty title="No expenses yet">Add the first one, then invite the others from the People tab.</Empty>
        </div>
      ) : (
        <ul className="card list">
          {items.map((it) =>
            it.kind === 'expense' ? (
              <li key={it.e.id}>
                <Link className="row" to={`/groups/${view.group.id}/expense/${it.e.id}`}>
                  <div className="grow">
                    <div className="title">{it.e.title}</div>
                    <div className="muted small">
                      {fmtDate(it.date)} · {paidBy(it.e)}
                      {it.e.recurring_id && <> · <span className="pill accent">repeats</span></>}
                    </div>
                  </div>
                  <div className="row-end">
                    <div className="money">{formatINR(it.e.amount_paise)}</div>
                    {effect(it.e)}
                  </div>
                </Link>
              </li>
            ) : (
              <li key={it.s.id}>
                <div className="row">
                  <div className="grow">
                    <div className="title">{name(it.s.from_member)} paid {name(it.s.to_member)}</div>
                    <div className="muted small">{fmtDate(it.date)} · payment{it.s.note ? ` · ${it.s.note}` : ''}</div>
                  </div>
                  <div className="row-end"><Money paise={it.s.amount_paise} /></div>
                  <button className="btn ghost sm" aria-label="Delete payment" onClick={() => setRemoving(it.s)}>✕</button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {removing && (
        <ConfirmSheet
          title="Delete this payment?" confirmLabel="Delete payment" danger onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await run(() => deleteSettlement(removing.id), 'Payment deleted')
            setRemoving(null)
          }}
        >
          {name(removing.from_member)} paid {name(removing.to_member)} {formatINR(removing.amount_paise)}. Balances will go back to what they were before it.
        </ConfirmSheet>
      )}
    </>
  )
}
