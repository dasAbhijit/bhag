import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { formatINR, parseINR, type Paise } from '../core/money'
import { allocate, computeSplit, splitRemaining, type SplitInput } from '../core/splits'
import type { Frequency, SplitMethod } from '../core/types'
import { saveExpense, saveRecurring, uploadReceipt } from '../data/api'
import { useLedger } from '../data/hooks'
import type { Expense, ExpensePayload } from '../data/types'
import type { GroupView } from '../data/ledger'
import { prepareReceipt } from '../lib/image'
import { useRun, useToast } from '../ui/toast'
import { CATEGORIES, ErrorNote, Field, Spinner, todayISO } from '../ui/ui'

const METHODS: [SplitMethod, string][] = [['equal', 'Equal'], ['exact', 'Exact'], ['percent', '%'], ['shares', 'Shares']]
const rupees = (p: Paise) => (p / 100).toFixed(2)

export default function ExpenseForm() {
  const { id = '', eid } = useParams()
  const { views, isLoading } = useLedger()
  const view = views.find((v) => v.group.id === id)
  const editing = eid ? view?.expenses.find((e) => e.id === eid) : undefined
  if (isLoading) return <Spinner />
  if (!view || (eid && !editing)) {
    return (
      <main className="page">
        <div className="card card-pad stack">
          <h1>Not found</h1>
          <Link className="btn" to={`/groups/${id}`}>Back to the group</Link>
        </div>
      </main>
    )
  }
  return <FormInner key={eid ?? 'new'} view={view} editing={editing} />
}

function FormInner({ view, editing }: { view: GroupView; editing?: Expense }) {
  const navigate = useNavigate()
  const run = useRun()
  const toast = useToast()
  const members = view.members
  const gid = view.group.id

  const initPayers = editing?.expense_payers ?? []
  const input = editing?.split_input as { percents?: Record<string, number>; shares?: Record<string, number> } | null

  const [title, setTitle] = useState(editing?.title ?? '')
  const [amountStr, setAmountStr] = useState(editing ? rupees(editing.amount_paise) : '')
  const [date, setDate] = useState(editing?.expense_date ?? todayISO())
  const [category, setCategory] = useState(editing?.category ?? 'general')
  const [note, setNote] = useState(editing?.note ?? '')

  const [multi, setMulti] = useState(initPayers.length > 1)
  const [payer, setPayer] = useState(initPayers[0]?.member_id ?? view.me?.id ?? members[0]?.id ?? '')
  const [payerAmts, setPayerAmts] = useState<Record<string, string>>(Object.fromEntries(initPayers.map((p) => [p.member_id, rupees(p.paid_paise)])))

  const [method, setMethod] = useState<SplitMethod>(editing?.split_method ?? 'equal')
  const [equalSel, setEqualSel] = useState<Set<string>>(new Set(editing ? editing.expense_splits.map((s) => s.member_id) : members.map((m) => m.id)))
  const [exact, setExact] = useState<Record<string, string>>(editing?.split_method === 'exact' ? Object.fromEntries(editing.expense_splits.map((s) => [s.member_id, rupees(s.owed_paise)])) : {})
  const [percent, setPercent] = useState<Record<string, string>>(Object.fromEntries(Object.entries(input?.percents ?? {}).map(([k, v]) => [k, String(v)])))
  const [shares, setShares] = useState<Record<string, string>>(Object.fromEntries(Object.entries(input?.shares ?? {}).map(([k, v]) => [k, String(v)])))

  const [repeat, setRepeat] = useState<'none' | Frequency>('none')
  const [endDate, setEndDate] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = parseINR(amountStr)

  // ---- who paid
  const payers = useMemo(() => {
    if (!total) return { rows: [] as { member_id: string; paid_paise: number }[], error: null as string | null, left: 0 }
    if (!multi) return { rows: [{ member_id: payer, paid_paise: total }], error: null, left: 0 }
    const rows = Object.entries(payerAmts)
      .map(([member_id, s]) => ({ member_id, paid_paise: parseINR(s) ?? 0 }))
      .filter((r) => r.paid_paise > 0)
    const left = total - rows.reduce((s, r) => s + r.paid_paise, 0)
    return { rows, left, error: rows.length === 0 ? 'Enter who paid' : left !== 0 ? 'Amounts paid must add up to the total' : null }
  }, [total, multi, payer, payerAmts])

  // ---- who owes
  const splitInput: SplitInput = useMemo(() => {
    const amounts = Object.fromEntries(Object.entries(exact).filter(([, s]) => s.trim() !== '').map(([k, s]) => [k, parseINR(s) ?? NaN]))
    const nums = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, s]) => s.trim() !== '').map(([k, s]) => [k, Number(s)]))
    if (method === 'equal') return { method, participants: [...equalSel] }
    if (method === 'exact') return { method, amounts }
    if (method === 'percent') return { method, percents: nums(percent) }
    return { method, shares: nums(shares) }
  }, [method, equalSel, exact, percent, shares])

  const split = useMemo(() => {
    if (!total) return { owed: {} as Record<string, Paise>, error: null as string | null }
    try {
      return { owed: computeSplit(total, splitInput), error: null }
    } catch (e) {
      return { owed: {} as Record<string, Paise>, error: e instanceof Error ? e.message : 'Invalid split' }
    }
  }, [total, splitInput])

  const remaining = total ? splitRemaining(total, splitInput) : 0

  function chooseMethod(next: SplitMethod) {
    setMethod(next)
    const ids = members.map((m) => m.id)
    if (next === 'exact' && Object.keys(exact).length === 0 && total) {
      const even = allocate(total, Object.fromEntries(ids.map((i) => [i, 1])))
      setExact(Object.fromEntries(ids.map((i) => [i, rupees(even[i])])))
    }
    if (next === 'percent' && Object.keys(percent).length === 0) {
      const even = allocate(10000, Object.fromEntries(ids.map((i) => [i, 1])))
      setPercent(Object.fromEntries(ids.map((i) => [i, String(even[i] / 100)])))
    }
    if (next === 'shares' && Object.keys(shares).length === 0) setShares(Object.fromEntries(ids.map((i) => [i, '1'])))
  }

  function togglePayerMode(on: boolean) {
    setMulti(on)
    if (on && Object.keys(payerAmts).length === 0 && total) setPayerAmts({ [payer]: rupees(total) })
  }

  const problem = !title.trim() ? 'Add a description' : !total ? 'Enter the amount in rupees' : payers.error ?? split.error
  const splitRows: SplitRowRender = { method, members, exact, setExact, percent, setPercent, shares, setShares, equalSel, setEqualSel, owed: split.owed }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (problem || !total) return setError(problem ?? 'Check the form')
    setError(null)
    setBusy(true)
    const splitInputSaved: Record<string, unknown> =
      splitInput.method === 'equal' ? { participants: splitInput.participants }
      : splitInput.method === 'exact' ? { amounts: splitInput.amounts }
      : splitInput.method === 'percent' ? { percents: splitInput.percents }
      : { shares: splitInput.shares }
    const payload: ExpensePayload = {
      id: editing?.id, group_id: gid, title: title.trim(), amount_paise: total, expense_date: date, category,
      split_method: method, split_input: splitInputSaved, note: note.trim(),
      payers: payers.rows,
      splits: Object.entries(split.owed).filter(([, v]) => v > 0).map(([member_id, owed_paise]) => ({ member_id, owed_paise })),
    }
    try {
      if (repeat !== 'none' && !editing) {
        const { id: _drop, ...rest } = payload
        void _drop
        const rid = await run(() => saveRecurring({ ...rest, frequency: repeat, start_date: date, end_date: endDate || null }), 'Repeating expense set up')
        if (rid) navigate(`/groups/${gid}`)
        return
      }
      const id = await run(() => saveExpense(payload), editing ? 'Expense updated' : 'Expense added')
      if (!id) return
      let failed = 0
      for (const f of files) {
        try {
          const { blob, ext } = await prepareReceipt(f)
          await uploadReceipt(gid, id, blob, ext)
        } catch (err) {
          failed++
          toast(err instanceof Error ? err.message : 'Could not upload a receipt', 'error')
        }
      }
      if (files.length) await run(async () => undefined)
      navigate(failed ? `/groups/${gid}/expense/${id}` : `/groups/${gid}`)
    } finally {
      setBusy(false)
    }
  }

  const equalCount = equalSel.size

  return (
    <main className="page">
      <div className="page-head">
        <Link to={editing ? `/groups/${gid}/expense/${editing.id}` : `/groups/${gid}`} className="back">‹ Cancel</Link>
        <h1>{editing ? 'Edit expense' : 'Add expense'}</h1>
      </div>
      <form className="stack" onSubmit={submit}>
        <div className="card card-pad stack">
          <Field label="Description"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Dinner, rent, taxi…" required autoFocus={!editing} /></Field>
          <div className="grid2 keep">
            <Field label="Amount (₹)"><input className="input money-in" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="0.00" required /></Field>
            <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          </div>
          <Field label="Category">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>

        <div className="card stack" style={{ paddingBottom: 12 }}>
          <div className="row" style={{ paddingBottom: 0 }}>
            <h2 className="grow">Paid by</h2>
            <label className="check small"><input type="checkbox" checked={multi} onChange={(e) => togglePayerMode(e.target.checked)} /> Several people paid</label>
          </div>
          {!multi ? (
            <div style={{ padding: '0 16px' }}>
              <select className="input" aria-label="Who paid" value={payer} onChange={(e) => setPayer(e.target.value)}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}{m.id === view.me?.id ? ' (you)' : ''}</option>)}
              </select>
            </div>
          ) : (
            <>
              {members.map((m) => (
                <div key={m.id} className="split-row">
                  <span>{m.display_name}</span>
                  <input className="input money-in" inputMode="decimal" aria-label={`${m.display_name} paid`} placeholder="0.00" value={payerAmts[m.id] ?? ''} onChange={(e) => setPayerAmts({ ...payerAmts, [m.id]: e.target.value })} />
                </div>
              ))}
              {total ? <div className={`remaining ${payers.left === 0 ? 'good' : 'bad'}`} style={{ padding: '0 16px', textAlign: 'right' }}>{payers.left === 0 ? 'Fully covered ✓' : `${formatINR(Math.abs(payers.left))} ${payers.left > 0 ? 'still to assign' : 'too much'}`}</div> : null}
            </>
          )}
        </div>

        <div className="card stack" style={{ paddingBottom: 12 }}>
          <div className="row" style={{ paddingBottom: 0 }}><h2>Split</h2></div>
          <div style={{ padding: '0 16px' }}>
            <div className="seg" role="group" aria-label="Split method">
              {METHODS.map(([k, l]) => <button type="button" key={k} aria-pressed={method === k} onClick={() => chooseMethod(k)}>{l}</button>)}
            </div>
          </div>
          <SplitRows {...splitRows} />
          <div style={{ padding: '0 16px', textAlign: 'right' }}>
            {method === 'equal' && <span className="muted small">{equalCount === 0 ? 'Choose at least one person' : total ? `${formatINR(Math.floor(total / equalCount))} each` : ''}</span>}
            {method === 'exact' && total ? <span className={`remaining ${remaining === 0 ? 'good' : 'bad'}`}>{remaining === 0 ? 'All assigned ✓' : `${formatINR(Math.abs(remaining))} ${remaining > 0 ? 'left to assign' : 'too much'}`}</span> : null}
            {method === 'percent' && <span className={`remaining ${remaining === 0 ? 'good' : 'bad'}`}>{remaining === 0 ? '100% assigned ✓' : `${(Math.abs(remaining) / 100).toFixed(2).replace(/\.?0+$/, '')}% ${remaining > 0 ? 'left to assign' : 'too much'}`}</span>}
            {method === 'shares' && <span className="muted small">Shares are relative. 2 and 1 means one person pays double.</span>}
          </div>
        </div>

        {!editing && (
          <div className="card card-pad stack">
            <div className="grid2 keep">
              <Field label="Repeat">
                <select className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as 'none' | Frequency)}>
                  <option value="none">Never</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="yearly">Every year</option>
                </select>
              </Field>
              {repeat !== 'none' && <Field label="Stop after (optional)"><input className="input" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} /></Field>}
            </div>
            {repeat !== 'none' && <p className="hint">Starts on the date above. Each one is added automatically on its day, split the same way.</p>}
          </div>
        )}

        <div className="card card-pad stack">
          <Field label="Note (optional)"><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          {repeat === 'none' && (
            <Field label="Receipt photos (optional)" hint="Photos are shrunk before upload. PDFs up to 5 MB also work.">
              <input className="input" type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
            </Field>
          )}
          {files.length > 0 && repeat === 'none' && (
            <ul className="list">
              {files.map((f, i) => (
                <li key={i} className="row"><span className="grow small">{f.name}</span><button type="button" className="btn ghost sm" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></li>
              ))}
            </ul>
          )}
        </div>

        <ErrorNote error={error} />
        <div className="sticky-actions">
          <button className="btn primary block" disabled={busy || Boolean(problem)} title={problem ?? undefined}>
            {busy ? 'Saving…' : repeat !== 'none' && !editing ? 'Save repeating expense' : 'Save expense'}
          </button>
          {problem && <p className="hint" style={{ textAlign: 'center', marginTop: 6 }}>{problem}</p>}
        </div>
      </form>
    </main>
  )
}

interface SplitRowRender {
  method: SplitMethod
  members: GroupView['members']
  exact: Record<string, string>
  setExact: (v: Record<string, string>) => void
  percent: Record<string, string>
  setPercent: (v: Record<string, string>) => void
  shares: Record<string, string>
  setShares: (v: Record<string, string>) => void
  equalSel: Set<string>
  setEqualSel: (v: Set<string>) => void
  owed: Record<string, Paise>
}

function SplitRows(p: SplitRowRender) {
  return (
    <div>
      {p.members.map((m) => {
        const owed = p.owed[m.id]
        const preview = owed !== undefined && owed > 0 ? formatINR(owed) : ''
        if (p.method === 'equal') {
          const on = p.equalSel.has(m.id)
          return (
            <div key={m.id} className="split-row">
              <label className="check">
                <input type="checkbox" checked={on} onChange={() => { const s = new Set(p.equalSel); if (on) s.delete(m.id); else s.add(m.id); p.setEqualSel(s) }} />
                {m.display_name}
              </label>
              <span className="money muted" style={{ textAlign: 'right' }}>{on ? preview : ''}</span>
            </div>
          )
        }
        const values = p.method === 'exact' ? p.exact : p.method === 'percent' ? p.percent : p.shares
        const setValues = p.method === 'exact' ? p.setExact : p.method === 'percent' ? p.setPercent : p.setShares
        return (
          <div key={m.id} className="split-row">
            <div>
              {m.display_name}
              {p.method !== 'exact' && preview && <div className="muted small money">{preview}</div>}
            </div>
            <input
              className="input money-in" inputMode="decimal" aria-label={`${m.display_name} ${p.method === 'percent' ? 'percent' : p.method === 'shares' ? 'shares' : 'amount'}`}
              placeholder={p.method === 'percent' ? '0 %' : p.method === 'shares' ? '0' : '0.00'}
              value={values[m.id] ?? ''} onChange={(e) => setValues({ ...values, [m.id]: e.target.value })}
            />
          </div>
        )
      })}
    </div>
  )
}
