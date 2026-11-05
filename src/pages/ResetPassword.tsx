import { useNavigate } from 'react-router-dom'
import PasswordForm from '../ui/PasswordForm'
import { useToast } from '../ui/toast'

/** Where the "reset your password" email brings people. They are already signed in by the link. */
export default function ResetPassword() {
  const navigate = useNavigate()
  const toast = useToast()
  return (
    <main className="page">
      <div className="page-head">
        <h1>Choose a new password</h1>
      </div>
      <div className="card card-pad stack">
        <p className="muted small">You are signed in from the link in your email. Set a new password to finish.</p>
        <PasswordForm
          submitLabel="Save new password"
          onDone={() => {
            toast('Password changed')
            navigate('/', { replace: true })
          }}
        />
      </div>
    </main>
  )
}
