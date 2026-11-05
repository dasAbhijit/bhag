import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { rememberNext, takeNext, useAuth } from './auth/auth'
import { supabaseConfigured } from './lib/supabase'
import Account from './pages/Account'
import Dashboard from './pages/Dashboard'
import ExpenseDetail from './pages/ExpenseDetail'
import ExpenseForm from './pages/ExpenseForm'
import Friends from './pages/Friends'
import GroupPage from './pages/group/GroupPage'
import Join from './pages/Join'
import Recurring from './pages/Recurring'
import Shell from './pages/Shell'
import SignIn from './pages/SignIn'
import { Spinner } from './ui/ui'

export default function App() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  // Sent here from an invite link while signed out: remember it, then return after sign-in.
  useEffect(() => {
    if (!loading && !user && location.pathname !== '/') rememberNext(location.pathname + location.search)
  }, [loading, user, location.pathname, location.search])
  useEffect(() => {
    if (!user) return
    const next = takeNext()
    if (next && next !== location.pathname) navigate(next, { replace: true })
    // Only when the user first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!supabaseConfigured) {
    return (
      <main className="auth">
        <h1>Bhag</h1>
        <div className="note">The app is not connected to its backend. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and rebuild.</div>
      </main>
    )
  }
  if (loading) return <Spinner />
  if (!user) return <SignIn />

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="friends" element={<Friends />} />
        <Route path="account" element={<Account />} />
        <Route path="join/:code" element={<Join />} />
        <Route path="groups/:id" element={<GroupPage />} />
        <Route path="groups/:id/recurring" element={<Recurring />} />
        <Route path="groups/:id/expense/new" element={<ExpenseForm />} />
        <Route path="groups/:id/expense/:eid" element={<ExpenseDetail />} />
        <Route path="groups/:id/expense/:eid/edit" element={<ExpenseForm />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
