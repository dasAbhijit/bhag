import { formatINR } from '../core/money'
import { CATEGORIES, isCategory } from '../core/categories'

/**
 * Reads an invoice photo with Google's Gemini API, using the person's own API key.
 * The key is kept only in this browser (localStorage) and is sent only to Google.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const STORAGE_KEY = 'bhag:gemini'

export const DEFAULT_MODEL = 'gemini-3.6-flash'
export const MODEL_CHOICES: [string, string][] = [
  ['gemini-3.6-flash', 'Gemini 3.6 Flash (recommended)'],
  ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite (cheapest)'],
  ['gemini-3.8-flash', 'Gemini 3.8 Flash (newest)'],
]

export interface ScanSettings {
  apiKey: string
  model: string
}

export function loadScanSettings(): ScanSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<ScanSettings>
    return v.apiKey ? { apiKey: v.apiKey, model: v.model || DEFAULT_MODEL } : null
  } catch {
    return null
  }
}
export function saveScanSettings(s: ScanSettings): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}
export function clearScanSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to clear */
  }
}

export class ScanError extends Error {
  /** True when trying again (or another model) may well work: Google 5xx replies and dropped connections. */
  readonly transient: boolean
  /** Technical line for troubleshooting: status, model, photo size, time. Shown small under the message. */
  readonly detail: string | undefined
  constructor(message: string, opts: { transient?: boolean; detail?: string } = {}) {
    super(message)
    this.name = 'ScanError'
    this.transient = opts.transient ?? false
    this.detail = opts.detail
  }
}

export interface ScannedItem {
  name: string
  amount_paise: number
}
export interface ScanResult {
  merchant: string
  date: string | null
  category: string
  currency: string | null
  items: ScannedItem[]
  total_paise: number
  /** Everything on the invoice that is not an item: tax, service, tip, minus discounts. Can be negative. */
  extra_paise: number
  warnings: string[]
}

const PROMPT = `You read invoices and receipts. Return ONLY a JSON object with exactly these keys:
- merchant: string, the shop or restaurant name
- date: string "YYYY-MM-DD" or null
- currency: 3-letter code such as "INR", or null
- category: one of ${CATEGORIES.map(([k]) => k).join(', ')}
- items: array of { "name": string, "quantity": number, "line_total": number } where line_total is the full price of that line after quantity
- subtotal: number or null
- tax: number or null (all taxes such as GST, VAT, CGST and SGST added together)
- service_charge: number or null
- tip: number or null
- discount: number or null (a positive number)
- total: number, the final amount payable

Rules:
- Copy numbers exactly as printed. Do not invent items or prices.
- Only list things that were bought. Skip payment method, change, card numbers and loyalty points.
- If a line shows quantity and unit price but no line total, line_total is quantity times unit price.
- Write numbers without currency symbols or thousands separators.
- If the image is not an invoice, return "items": [] and "total": 0.`

// ---------- parsing ----------

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}
const paise = (n: number | null): number => (n === null ? 0 : Math.round(n * 100))
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null
  const year = Number(v.slice(0, 4))
  return year >= 2000 && year <= new Date().getUTCFullYear() + 1 ? v : null
}

/** Turn the model's reply into a safe, typed result. Never trusts the shape of the reply. */
export function parseScanText(raw: string): ScanResult {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new ScanError('The reply did not contain any invoice details. Try a clearer photo.')
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new ScanError('Could not understand the reply. Try again, or enter the expense by hand.')
  }

  const warnings: string[] = []
  let discount = paise(num(obj.discount))
  const items: ScannedItem[] = []
  const rawItems = Array.isArray(obj.items) ? obj.items.slice(0, 100) : []
  for (const r of rawItems) {
    if (typeof r !== 'object' || r === null) continue
    const it = r as Record<string, unknown>
    const name = text(it.name, 80)
    const amount = paise(num(it.line_total ?? it.amount ?? it.price))
    if (!name) continue
    if (amount < 0) {
      discount += -amount // a coupon or discount printed as a negative line
      continue
    }
    if (amount === 0) continue
    const qty = num(it.quantity)
    items.push({ name: qty !== null && Number.isInteger(qty) && qty > 1 && !/^\d+\s*[x×]/i.test(name) ? `${qty} × ${name}` : name, amount_paise: amount })
  }

  const itemsSum = items.reduce((s, i) => s + i.amount_paise, 0)
  const charges = paise(num(obj.tax)) + paise(num(obj.service_charge)) + paise(num(obj.tip)) - discount
  const printed = paise(num(obj.total))
  const total = printed > 0 ? printed : itemsSum + charges
  const extra = total - itemsSum

  if (items.length === 0) warnings.push('No items were found. Add them by hand, or try a clearer photo.')
  else if (printed > 0 && Math.abs(itemsSum + charges - printed) >= 100) {
    warnings.push(`The items and charges add up to ${formatINR(itemsSum + charges)}, but the invoice total is ${formatINR(printed)}. Check the items and the tax line.`)
  }

  const currency = typeof obj.currency === 'string' && /^[A-Za-z]{3}$/.test(obj.currency.trim()) ? obj.currency.trim().toUpperCase() : null
  if (currency && currency !== 'INR') warnings.push(`The invoice says ${currency}. Amounts are shown as printed. Bhag only works in rupees.`)

  return {
    merchant: text(obj.merchant, 80),
    date: validDate(obj.date),
    category: isCategory(obj.category) ? obj.category : 'general',
    currency,
    items,
    total_paise: total,
    extra_paise: extra,
    warnings,
  }
}

// ---------- calling Gemini ----------

type FetchFn = typeof fetch

/** Used when the chosen model keeps failing with a Google-side error. Cheaper, and rarely as busy. */
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite'
/** Waits before the 2nd and 3rd try of a model. */
const RETRY_DELAYS_MS = [1200, 3000]

interface GoogleErrorBody {
  error?: { message?: string; status?: string }
}

function describeHttpError(status: number, body: unknown, model: string): string {
  const err = (body as GoogleErrorBody | null)?.error
  const msg = err?.message
  if (status === 400 && msg && /api key/i.test(msg)) return 'Google did not accept that API key. Check it in Account.'
  if (status === 401 || status === 403) return `Google refused the request${msg ? `: ${msg}` : ''}. Check that the key is valid and the Gemini API is enabled for it.`
  if (status === 404) return `Google does not know the model “${model}”. Choose another model in Account.`
  if (status === 429) return 'Google says the free limit for this key has been reached. Wait a bit and try again.'
  if (status >= 500) {
    const why = [String(status), err?.status, msg ? msg.slice(0, 140) : ''].filter(Boolean).join(' · ')
    return `Google had a problem on its side (${why}). Try again in a moment.`
  }
  return msg ? `Google said: ${msg}` : `Google returned an error (${status}).`
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new ScanError('Could not read the photo'))
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(blob)
  })
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`

/** One request to one model. Throws ScanError, marked transient when a retry is worthwhile. */
async function scanOnce(image: Blob, data: string, apiKey: string, model: string, fetchFn: FetchFn, timeoutMs: number): Promise<ScanResult> {
  const started = Date.now()
  const base = `${model} · photo ${kb(image.size)}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchFn(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType: image.type || 'image/jpeg', data } }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: ctrl.signal,
    })
  } catch (e) {
    const detail = `no reply · ${base} · ${Date.now() - started} ms`
    if (e instanceof DOMException && e.name === 'AbortError') throw new ScanError('Reading the invoice took too long. Try again.', { detail })
    throw new ScanError('Could not reach Google. Check your internet connection.', { transient: true, detail })
  } finally {
    clearTimeout(timer)
  }

  const body = (await readJson(res)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    promptFeedback?: { blockReason?: string }
  } & GoogleErrorBody | null
  const detail = `HTTP ${res.status}${body?.error?.status ? ' ' + body.error.status : ''} · ${base} · ${Date.now() - started} ms`
  if (!res.ok) throw new ScanError(describeHttpError(res.status, body, model), { transient: res.status >= 500, detail })
  const reply = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!reply) {
    if (body?.promptFeedback?.blockReason) throw new ScanError('Google blocked this image. Try a different photo.', { detail })
    throw new ScanError('Google returned an empty reply. Try again.', { transient: true, detail })
  }
  try {
    return parseScanText(reply)
  } catch (e) {
    throw new ScanError(e instanceof Error ? e.message : 'Could not read the reply', { detail })
  }
}

export interface ScanHooks {
  /** Called when a try failed for a temporary reason and another is about to start. */
  onStatus?: (message: string) => void
  /** Replaceable so tests do not have to wait. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Read an invoice photo. Temporary Google-side errors (5xx) and dropped connections are retried
 * on their own, then once more with a lighter model, and the result says when that happened.
 * Errors that retrying cannot fix (bad key, quota, wrong model) are reported straight away.
 */
export async function scanReceipt(
  image: Blob,
  settings: ScanSettings,
  fetchFn: FetchFn = fetch,
  timeoutMs = 90_000,
  hooks: ScanHooks = {},
): Promise<ScanResult> {
  const sleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const data = await blobToBase64(image)
  const models = settings.model === FALLBACK_MODEL ? [settings.model] : [settings.model, FALLBACK_MODEL]
  let last: ScanError | null = null

  for (const [m, model] of models.entries()) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const result = await scanOnce(image, data, settings.apiKey, model, fetchFn, timeoutMs)
        if (m > 0) result.warnings.push(`Read with ${model} because ${settings.model} was busy. Check the items carefully.`)
        return result
      } catch (e) {
        if (!(e instanceof ScanError) || !e.transient) throw e
        last = e
        if (attempt < RETRY_DELAYS_MS.length) {
          hooks.onStatus?.('Google is busy, trying again…')
          await sleep(RETRY_DELAYS_MS[attempt])
        } else if (m < models.length - 1) {
          hooks.onStatus?.(`Still busy, trying ${models[m + 1]}…`)
        }
      }
    }
  }
  throw last ?? new ScanError('Could not read the invoice')
}

/** Checks that the key works and the model exists, without sending any photo. */
export async function testScanSettings(settings: ScanSettings, fetchFn: FetchFn = fetch): Promise<void> {
  let res: Response
  try {
    res = await fetchFn(`${BASE}/models/${encodeURIComponent(settings.model)}`, { headers: { 'x-goog-api-key': settings.apiKey } })
  } catch {
    throw new ScanError('Could not reach Google. Check your internet connection.')
  }
  if (!res.ok) throw new ScanError(describeHttpError(res.status, await readJson(res), settings.model))
}
