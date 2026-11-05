import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { rememberNext, takeNext, useAuth } from './auth/auth'
import { supabaseConfigured } from './lib/supabase'
import Dashboard from './pages/Dashboard'
import Shell from './pages/Shell'
import SignIn from './pages/SignIn'
import { Spinner } from './ui/ui'

// Everything except the home screen loads on demand, so the first screen appears quickly on a phone.
const Account = lazy(() => import('./pages/Account'))
const ExpenseDetail = lazy(() => import('./pages/ExpenseDetail'))
const ExpenseForm = lazy(() => import('./pages/ExpenseForm'))
const Friends = lazy(() => import('./pages/Friends'))
const GroupPage = lazy(() => import('./pages/group/GroupPage'))
const Join = lazy(() => import('./pages/Join'))
const Recurring = lazy(() => import('./pages/Recurring'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))

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
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="friends" element={<Friends />} />
          <Route path="account" element={<Account />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="join/:code" element={<Join />} />
          <Route path="groups/:id" element={<GroupPage />} />
          <Route path="groups/:id/recurring" element={<Recurring />} />
          <Route path="groups/:id/expense/new" element={<ExpenseForm />} />
          <Route path="groups/:id/expense/:eid" element={<ExpenseDetail />} />
          <Route path="groups/:id/expense/:eid/edit" element={<ExpenseForm />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
