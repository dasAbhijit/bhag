import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/auth'
import { loadProfileName, updateProfileName } from '../data/api'
import {
  clearScanSettings, DEFAULT_MODEL, loadScanSettings, MODEL_CHOICES, saveScanSettings, testScanSettings,
} from '../lib/scan'
import { useRun, useToast } from '../ui/toast'
import { ErrorNote, Field } from '../ui/ui'

export default function Account() {
  const { user, signOut } = useAuth()
  const run = useRun()
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!user) return
    loadProfileName(user.id)
      .then(setName)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [user])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (user) await run(() => updateProfileName(user.id, name.trim()), 'Name saved')
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1>Account</h1>
      </div>
      <form className="card card-pad stack" onSubmit={save}>
        <Field label="Your name" hint="Shown to people in groups you create or join from now on.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!loaded} maxLength={60} />
        </Field>
        <div className="muted small">Signed in as {user?.email}</div>
        <button className="btn primary" disabled={!loaded || !name.trim()}>
          Save name
        </button>
      </form>

      <ScanSettingsCard />

      <div className="card card-pad stack">
        <h2>Install on your phone</h2>
        <p className="muted small">
          iPhone: open this page in Safari, tap Share, then Add to Home Screen. Android: open the browser menu and choose Install app.
        </p>
        <a href="https://github.com/dasAbhijit/bhag" target="_blank" rel="noreferrer">Source code and user guide</a>
      </div>
      <button className="btn" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  )
}

function ScanSettingsCard() {
  const toast = useToast()
  const saved = loadScanSettings()
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? '')
  const [model, setModel] = useState(saved?.model ?? DEFAULT_MODEL)
  const [hasKey, setHasKey] = useState(Boolean(saved))
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [good, setGood] = useState(false)

  const current = { apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODEL }

  function save() {
    if (!current.apiKey) return setError('Paste your API key first')
    if (!saveScanSettings(current)) return setError('This browser would not let Bhag save the key. Check that private browsing is off.')
    setHasKey(true)
    setError(null)
    toast('Saved on this device')
  }

  async function test() {
    setBusy(true)
    setError(null)
    setGood(false)
    try {
      await testScanSettings(current)
      setGood(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The test failed')
    } finally {
      setBusy(false)
    }
  }

  function remove() {
    clearScanSettings()
    setApiKey('')
    setHasKey(false)
    setGood(false)
    setError(null)
    toast('Key removed from this device')
  }

  return (
    <div className="card card-pad stack">
      <div>
        <h2>Invoice scanning</h2>
        <p className="muted small">
          Scan a bill and Bhag fills in the items for you. It uses Google Gemini with your own API key.
          {' '}<a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a key from Google AI Studio</a>.
        </p>
      </div>
      <Field label="Gemini API key" hint="Saved only in this browser on this device. You will need to add it again on your other devices.">
        <div className="actions" style={{ flexWrap: 'nowrap' }}>
          <input
            className="input" type={show ? 'text' : 'password'} value={apiKey} autoComplete="off" spellCheck={false}
            onChange={(e) => { setApiKey(e.target.value); setGood(false) }} placeholder="AIza…"
          />
          <button type="button" className="btn sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
        </div>
      </Field>
      <Field label="Model">
        <select className="input" value={MODEL_CHOICES.some(([k]) => k === model) ? model : '__other'} onChange={(e) => e.target.value !== '__other' && setModel(e.target.value)}>
          {MODEL_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          <option value="__other">Other (type below)</option>
        </select>
        {!MODEL_CHOICES.some(([k]) => k === model) && (
          <input className="input" aria-label="Model name" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model name" />
        )}
      </Field>
      <ErrorNote error={error} />
      {good && <div className="note info" role="status">The key works and the model is available.</div>}
      <div className="actions">
        <button className="btn primary" onClick={save} disabled={!apiKey.trim()}>Save</button>
        <button className="btn" onClick={() => void test()} disabled={busy || !apiKey.trim()}>{busy ? 'Testing…' : 'Test key'}</button>
        {hasKey && <button className="btn ghost danger" onClick={remove}>Remove key</button>}
      </div>
      <p className="hint">
        When you scan, the photo of the invoice goes to Google and counts against your key's quota. On Google's free tier, Google may use what you send to improve its products, so avoid scanning anything private. See Google's current terms for details.
      </p>
    </div>
  )
}
