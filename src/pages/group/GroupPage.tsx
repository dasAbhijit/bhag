import { useEffect, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { postDueRecurring } from '../../data/api'
import { useLedger } from '../../data/hooks'
import { ErrorNote, Spinner } from '../../ui/ui'
import ActivityTab from './ActivityTab'
import BalancesTab from './BalancesTab'
import ExpensesTab from './ExpensesTab'
import PeopleTab from './PeopleTab'

const TABS = [
  ['expenses', 'Expenses'],
  ['balances', 'Balances'],
  ['activity', 'Activity'],
  ['people', 'People'],
] as const

export default function GroupPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { views, isLoading, error, userId } = useLedger()
  const qc = useQueryClient()
  const view = views.find((v) => v.group.id === id)
  const tab = TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'expenses'

  // Post any recurring expenses that came due, in case the daily server job is not running.
  const checked = useRef<string | null>(null)
  useEffect(() => {
    if (!view || checked.current === id) return
    checked.current = id
    postDueRecurring(id)
      .then((n) => {
        if (n > 0) void qc.invalidateQueries()
      })
      .catch(() => {})
  }, [view, id, qc])

  if (isLoading) return <Spinner />
  if (error) return <main className="page"><ErrorNote error={error} /></main>
  if (!view) {
    return (
      <main className="page">
        <div className="card card-pad stack">
          <h1>Group not found</h1>
          <p className="muted">It may have been deleted, or you may not be a member.</p>
          <Link className="btn" to="/">Back to your groups</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-head">
        <Link to="/" className="back" aria-label="Back to groups">‹ Back</Link>
        <h1>{view.group.name}</h1>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k}
            onClick={() => setParams(k === 'expenses' ? {} : { tab: k }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'expenses' && <ExpensesTab view={view} />}
      {tab === 'balances' && <BalancesTab view={view} />}
      {tab === 'activity' && <ActivityTab view={view} />}
      {tab === 'people' && <PeopleTab view={view} userId={userId} />}
    </main>
  )
}
