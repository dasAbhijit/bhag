import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth'
import { client, supabase } from '../lib/supabase'
import { loadAll } from './api'
import { buildFriends, buildViews } from './ledger'

const TABLES = [
  'groups', 'group_members', 'expenses', 'expense_payers', 'expense_splits',
  'settlements', 'comments', 'attachments', 'activity_log', 'recurring_templates',
]

/** Refresh data whenever anyone in your groups changes something, on any device. */
export function useRealtime() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const userId = user?.id
  useEffect(() => {
    if (!userId || !supabase) return
    const sb = client()
    let timer: number | undefined
    const bump = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void qc.invalidateQueries(), 300)
    }
    const channel = sb.channel('bhag-sync')
    for (const table of TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table }, bump)
    channel.subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      void sb.removeChannel(channel)
    }
  }, [userId, qc])
}

export function useLedger() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const query = useQuery({ queryKey: ['data', userId], queryFn: loadAll, enabled: Boolean(userId), staleTime: 15_000 })
  const views = useMemo(() => (query.data ? buildViews(query.data, userId) : []), [query.data, userId])
  const friends = useMemo(() => buildFriends(views, userId), [views, userId])
  return { userId, data: query.data, views, friends, isLoading: query.isLoading, error: query.error as Error | null }
}
