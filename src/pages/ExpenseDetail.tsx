import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/auth'
import { formatINR } from '../core/money'
import { addComment, deleteComment, deleteExpense, deleteReceipt, loadAttachments, loadComments, receiptUrl, restoreExpense, uploadReceipt } from '../data/api'
import { useLedger } from '../data/hooks'
import type { Attachment } from '../data/types'
import { prepareReceipt } from '../lib/image'
import { useRun, useToast } from '../ui/toast'
import { categoryLabel, ConfirmSheet, fmtDate, fmtDateTime, Money, Spinner } from '../ui/ui'

export default function ExpenseDetail() {
  const { id = '', eid = '' } = useParams()
  const navigate = useNavigate()
  const run = useRun()
  const { user } = useAuth()
  const { views, isLoading } = useLedger()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const view = views.find((v) => v.group.id === id)
  const expense = view && [...view.expenses, ...view.deleted].find((e) => e.id === eid)

  if (isLoading) return <Spinner />
  if (!view || !expense) {
    return (
      <main className="page">
        <div className="card card-pad stack"><h1>Expense not found</h1><Link className="btn" to={`/groups/${id}`}>Back to the group</Link></div>
      </main>
    )
  }
  const name = (m: string) => view.memberById.get(m)?.display_name ?? 'Someone'
  const deleted = Boolean(expense.deleted_at)
  const method = { equal: 'equally', exact: 'by exact amounts', percent: 'by percentage', shares: 'by shares' }[expense.split_method]
  const pct = (expense.split_input as { percents?: Record<string, number> } | null)?.percents
  const sh = (expense.split_input as { shares?: Record<string, number> } | null)?.shares

  return (
    <main className="page">
      <div className="page-head">
        <Link to={`/groups/${id}`} className="back">‹ Back</Link>
        <h1 className={deleted ? 'strike' : ''}>{expense.title}</h1>
        {!deleted && (
          <div className="actions">
            <Link className="btn sm" to={`/groups/${id}/expense/${eid}/edit`}>Edit</Link>
            <button className="btn danger sm" onClick={() => setConfirmDelete(true)}>Delete</button>
          </div>
        )}
      </div>

      {deleted && (
        <div className="note">
          This expense was deleted and does not count towards balances.{' '}
          <button className="btn sm" onClick={() => run(() => restoreExpense(eid), 'Expense restored')}>Restore</button>
        </div>
      )}

      <div className="card card-pad stack">
        <div>
          <div style={{ fontSize: '1.8rem', fontWeight: 700 }} className="money">{formatINR(expense.amount_paise)}</div>
          <div className="muted">{fmtDate(expense.expense_date)} · {categoryLabel(expense.category)}{expense.recurring_id ? ' · repeats' : ''}</div>
        </div>
        {expense.note && <p style={{ whiteSpace: 'pre-wrap' }}>{expense.note}</p>}
        <div>
          <div className="label">Paid by</div>
          {expense.expense_payers.map((p) => <div key={p.member_id}>{name(p.member_id)} paid <Money paise={p.paid_paise} /></div>)}
        </div>
      </div>

      <div className="section-title"><h2>Split {method}</h2></div>
      <ul className="card list">
        {expense.expense_splits.map((s) => (
          <li key={s.member_id} className="row">
            <div className="grow">{name(s.member_id)}{expense.split_method === 'percent' && pct?.[s.member_id] !== undefined && <span className="muted small"> · {pct[s.member_id]}%</span>}{expense.split_method === 'shares' && sh?.[s.member_id] !== undefined && <span className="muted small"> · {sh[s.member_id]} {sh[s.member_id] === 1 ? 'share' : 'shares'}</span>}</div>
            <Money paise={s.owed_paise} />
          </li>
        ))}
      </ul>

      <Receipts groupId={id} expenseId={eid} />
      <Comments expenseId={eid} myUserId={user?.id ?? ''} />

      {confirmDelete && (
        <ConfirmSheet
          title="Delete this expense?" confirmLabel="Delete" danger onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if ((await run(() => deleteExpense(eid), 'Expense deleted')) !== undefined) navigate(`/groups/${id}`)
          }}
        >
          “{expense.title}” will be removed from balances. Anyone in the group can restore it from the Activity tab.
        </ConfirmSheet>
      )}
    </main>
  )
}

function Receipts({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const run = useRun()
  const toast = useToast()
  const q = useQuery({ queryKey: ['attachments', expenseId], queryFn: () => loadAttachments(expenseId) })
  const [busy, setBusy] = useState(false)

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    for (const f of Array.from(files)) {
      try {
        const { blob, ext } = await prepareReceipt(f)
        await uploadReceipt(groupId, expenseId, blob, ext)
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not upload', 'error')
      }
    }
    await run(async () => undefined, 'Receipt added')
    setBusy(false)
  }

  return (
    <>
      <div className="section-title"><h2>Receipts</h2></div>
      <div className="card card-pad stack">
        {q.data && q.data.length > 0 && (
          <div className="thumbs">{q.data.map((a) => <Thumb key={a.id} a={a} onRemove={() => run(() => deleteReceipt(a.id), 'Receipt removed')} />)}</div>
        )}
        {q.data?.length === 0 && <p className="muted small">No receipts yet. Photos are stored for reference only. Nothing is read from them.</p>}
        <label className="btn sm" style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Uploading…' : '+ Add photo or PDF'}
          <input className="sr" type="file" accept="image/*,application/pdf" multiple disabled={busy} onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
        </label>
      </div>
    </>
  )
}

function Thumb({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    receiptUrl(a.storage_path).then((u) => alive && setUrl(u)).catch(() => {})
    return () => { alive = false }
  }, [a.storage_path])
  const isPdf = a.mime === 'application/pdf'
  return (
    <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open receipt">
          {isPdf ? <span className="thumb" style={{ display: 'grid', placeItems: 'center', background: 'var(--surface-2)' }}>PDF</span> : <img className="thumb" src={url} alt="Receipt" />}
        </a>
      ) : <span className="thumb" style={{ display: 'block', background: 'var(--surface-2)' }} />}
      <button className="btn ghost sm" onClick={onRemove}>Remove</button>
    </div>
  )
}

function Comments({ expenseId, myUserId }: { expenseId: string; myUserId: string }) {
  const run = useRun()
  const q = useQuery({ queryKey: ['comments', expenseId], queryFn: () => loadComments(expenseId) })
  const [body, setBody] = useState('')

  async function post(e: FormEvent) {
    e.preventDefault()
    if (await run(() => addComment(expenseId, body.trim()))) setBody('')
  }

  return (
    <>
      <div className="section-title"><h2>Comments</h2></div>
      <div className="card">
        {q.data && q.data.length > 0 && (
          <ul className="list">
            {q.data.map((c) => (
              <li key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div><strong>{c.author_name}</strong> <span className="muted small">{fmtDateTime(c.created_at)}</span></div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</div>
                </div>
                {c.author_user_id === myUserId && <button className="btn ghost sm" aria-label="Delete comment" onClick={() => run(() => deleteComment(c.id))}>✕</button>}
              </li>
            ))}
          </ul>
        )}
        <form className="row" onSubmit={post}>
          <input className="input" placeholder="Write a comment…" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} aria-label="Comment" />
          <button className="btn sm" disabled={!body.trim()}>Post</button>
        </form>
      </div>
    </>
  )
}
