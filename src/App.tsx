import { supabaseConfigured } from './lib/supabase'
import './App.css'

export default function App() {
  return (
    <main style={{ maxWidth: 480, margin: '3rem auto', padding: '0 16px' }}>
      <h1>Bhag</h1>
      <p>Split bills with friends and family. Amounts in ₹.</p>
      <p>Backend: {supabaseConfigured ? 'connected config found' : 'not configured yet'}</p>
    </main>
  )
}
