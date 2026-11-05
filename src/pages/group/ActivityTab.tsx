import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { loadActivity, restoreExpense } from '../../data/api'
import { describeActivity } from '../../data/activity'
import type { GroupView } from '../../data/ledger'
import { useRun } from '../../ui/toast'
import { Empty, ErrorNote, fmtDateTime, Spinner } from '../../ui/ui'

export default function ActivityTab({ view }: { view: GroupView }) {
  const run = useRun()
  const q = useQuery({ queryKey: ['activity', view.group.id], queryFn: () => loadActivity(view.group.id) })
  const nameOf = (id: string) => view.memberById.get(id)?.display_name ?? 'Someone'
  const deletedIds = new Set(view.deleted.map((e) => e.id))

  if (q.isLoading) return <Spinner />
  if (q.error) return <ErrorNote error={q.error as Error} />
  if (!q.data?.length) return <div className="card"><Empty title="Nothing here yet">Changes to this group will be listed here.</Empty></div>

  return (
    <ul className="card list activity">
      {q.data.map((a) => {
        const d = describeActivity(a, nameOf)
        const canRestore = a.action === 'expense_deleted' && a.entity_id && deletedIds.has(a.entity_id)
        const link = a.entity_id && a.entity_type === 'expense' && !deletedIds.has(a.entity_id) && a.action !== 'expense_deleted'
        return (
          <li key={a.id} className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <div>
                <span className="who">{a.actor_name}</span> {d.text}
              </div>
              {d.details.length > 0 && (
                <ul className="diff">{d.details.map((x, i) => <li key={i}>{x}</li>)}</ul>
              )}
              <div className="muted small">
                {fmtDateTime(a.created_at)}
                {link && <> · <Link to={`/groups/${view.group.id}/expense/${a.entity_id}`}>Open</Link></>}
              </div>
            </div>
            {canRestore && (
              <button className="btn sm" onClick={() => run(() => restoreExpense(a.entity_id!), 'Expense restored')}>
                Restore
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
