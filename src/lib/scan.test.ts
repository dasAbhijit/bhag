// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODEL, FALLBACK_MODEL, parseScanText, scanReceipt, ScanError, testScanSettings } from './scan'

const reply = (o: unknown) => JSON.stringify(o)
const good = {
  merchant: ' Cafe Mocha ', date: '2026-11-02', currency: 'INR', category: 'food',
  items: [
    { name: 'Masala Dosa', quantity: 2, line_total: 240 },
    { name: 'Filter Coffee', quantity: 1, line_total: 90.5 },
    { name: 'Free Water', quantity: 1, line_total: 0 },
    { name: '', quantity: 1, line_total: 10 },
  ],
  subtotal: 330.5, tax: 16.53, service_charge: 0, tip: null, discount: null, total: 347.03,
}

describe('parseScanText', () => {
  it('turns a normal reply into paise and tidy items', () => {
    const r = parseScanText(reply(good))
    expect(r.merchant).toBe('Cafe Mocha')
    expect(r.date).toBe('2026-11-02')
    expect(r.category).toBe('food')
    expect(r.items).toEqual([{ name: '2 × Masala Dosa', amount_paise: 24000 }, { name: 'Filter Coffee', amount_paise: 9050 }])
    expect(r.total_paise).toBe(34703)
    expect(r.extra_paise).toBe(34703 - 33050)
    expect(r.warnings).toEqual([])
  })

  it('copes with code fences, text around the JSON, and numbers as strings', () => {
    const r = parseScanText('Here you go:\n```json\n' + reply({ ...good, total: '₹1,347.03', items: [{ name: 'Thali', line_total: '1,300.00' }] }) + '\n```')
    expect(r.items[0].amount_paise).toBe(130000)
    expect(r.total_paise).toBe(134703)
  })

  it('treats negative lines as discounts and warns when the numbers do not add up', () => {
    const r = parseScanText(reply({ merchant: 'X', items: [{ name: 'A', line_total: 500 }, { name: 'Coupon', line_total: -50 }], tax: 0, total: 450 }))
    expect(r.items).toHaveLength(1)
    expect(r.extra_paise).toBe(-5000)
    expect(r.warnings).toEqual([])
    const off = parseScanText(reply({ items: [{ name: 'A', line_total: 500 }], total: 900 }))
    expect(off.warnings[0]).toMatch(/add up to ₹500.00, but the invoice total is ₹900.00/)
    expect(off.extra_paise).toBe(40000)
  })

  it('falls back to items plus charges when no total is printed', () => {
    const r = parseScanText(reply({ items: [{ name: 'A', line_total: 100 }], tax: 5, total: 0 }))
    expect(r.total_paise).toBe(10500)
    expect(r.extra_paise).toBe(500)
  })

  it('cleans up bad dates, categories and currencies', () => {
    const r = parseScanText(reply({ ...good, date: '2026-02-31', category: 'pizza', currency: 'usd' }))
    expect(r.date).toBeNull()
    expect(r.category).toBe('general')
    expect(r.warnings.join(' ')).toMatch(/USD/)
    expect(parseScanText(reply({ ...good, date: '1999-01-01' })).date).toBeNull()
  })

  it('reports when nothing was found, and rejects non-JSON', () => {
    expect(parseScanText(reply({ items: [], total: 0 })).warnings[0]).toMatch(/No items/)
    expect(() => parseScanText('Sorry, I cannot read that.')).toThrow(ScanError)
    expect(() => parseScanText('{ not json }')).toThrow(/Could not understand/)
  })

  it('never lets a weird reply crash it', () => {
    const r = parseScanText(reply({ merchant: 5, items: 'nope', total: 'abc', date: 12, category: null }))
    expect(r.items).toEqual([])
    expect(r.total_paise).toBe(0)
  })
})

describe('scanReceipt', () => {
  const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
  const settings = { apiKey: 'k-123', model: DEFAULT_MODEL }
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it('sends the image to Gemini with the key in a header, never in the URL', async () => {
    const fetchFn = ok({ candidates: [{ content: { parts: [{ text: reply(good) }] } }] })
    const r = await scanReceipt(photo, settings, fetchFn)
    expect(r.items).toHaveLength(2)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`)
    expect(url).not.toContain('k-123')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k-123')
    const body = JSON.parse(init.body as string)
    expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'AQID' })
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('turns Google errors into plain messages', async () => {
    await expect(scanReceipt(photo, settings, ok({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400))).rejects.toThrow(/did not accept that API key/)
    await expect(scanReceipt(photo, settings, ok({ error: { message: 'x' } }, 404))).rejects.toThrow(/does not know the model/)
    await expect(scanReceipt(photo, settings, ok({}, 429))).rejects.toThrow(/limit/)
    await expect(scanReceipt(photo, settings, ok({ promptFeedback: { blockReason: 'SAFETY' } }))).rejects.toThrow(/blocked/)
    await expect(scanReceipt(photo, settings, ok({ candidates: [] }), 90_000, { sleep: async () => {} })).rejects.toThrow(/empty reply/)
    const offline = vi.fn(async () => { throw new TypeError('network') }) as unknown as typeof fetch
    await expect(scanReceipt(photo, settings, offline, 90_000, { sleep: async () => {} })).rejects.toThrow(/Could not reach Google/)
  })

  it('tests a key without sending a photo', async () => {
    const f = ok({ name: 'models/x' })
    await testScanSettings(settings, f)
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}`)
    await expect(testScanSettings(settings, ok({ error: { message: 'API key not valid' } }, 400))).rejects.toThrow(ScanError)
  })
})

describe('scanReceipt: temporary Google errors', () => {
  const photo = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })
  const settings = { apiKey: 'k-123', model: DEFAULT_MODEL }
  const noWait = { sleep: async () => {} }
  const goodReply = { candidates: [{ content: { parts: [{ text: JSON.stringify({ merchant: 'Cafe', items: [{ name: 'Tea', line_total: 50 }], total: 50 }) }] } }] }
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })
  const busy = () => json({ error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' } }, 503)
  const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]).split('/models/')[1].split(':')[0])

  it('tries again by itself and succeeds without bothering the person', async () => {
    const f = vi.fn().mockImplementationOnce(async () => busy()).mockImplementationOnce(async () => busy()).mockImplementationOnce(async () => json(goodReply, 200))
    const status: string[] = []
    const r = await scanReceipt(photo, settings, f as unknown as typeof fetch, 90_000, { ...noWait, onStatus: (m) => status.push(m) })
    expect(f).toHaveBeenCalledTimes(3)
    expect(urls(f)).toEqual([DEFAULT_MODEL, DEFAULT_MODEL, DEFAULT_MODEL])
    expect(r.warnings).toEqual([])
    expect(status).toEqual(['Google is busy, trying again…', 'Google is busy, trying again…'])
  })

  it('falls back to the lighter model when the chosen one stays busy, and says so', async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => (String(url).includes(FALLBACK_MODEL) ? json(goodReply, 200) : busy()))
    const r = await scanReceipt(photo, settings, f as unknown as typeof fetch, 90_000, noWait)
    expect(urls(f as unknown as ReturnType<typeof vi.fn>)).toEqual([DEFAULT_MODEL, DEFAULT_MODEL, DEFAULT_MODEL, FALLBACK_MODEL])
    expect(r.warnings.join(' ')).toContain(`Read with ${FALLBACK_MODEL} because ${DEFAULT_MODEL} was busy`)
  })

  it('shows the real status, Google\'s words and a troubleshooting line when everything fails', async () => {
    const f = vi.fn(async () => busy()) as unknown as typeof fetch
    const err = (await scanReceipt(photo, settings, f, 90_000, noWait).catch((e: unknown) => e)) as ScanError
    expect(err).toBeInstanceOf(ScanError)
    expect(err.message).toContain('503')
    expect(err.message).toContain('UNAVAILABLE')
    expect(err.message).toContain('The model is overloaded')
    expect(err.detail).toMatch(/^HTTP 503 UNAVAILABLE · gemini-3\.5-flash-lite · photo 2 KB · \d+ ms$/)
    expect(f).toHaveBeenCalledTimes(6) // 3 tries on each of the two models
  })

  it('does not try a fallback when the lighter model is already the one chosen', async () => {
    const f = vi.fn(async () => busy())
    await expect(scanReceipt(photo, { ...settings, model: FALLBACK_MODEL }, f as unknown as typeof fetch, 90_000, noWait)).rejects.toThrow(/503/)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('does not retry things retrying cannot fix', async () => {
    for (const [status, body, text] of [
      [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, /did not accept that API key/],
      [403, { error: { message: 'denied' } }, /refused/],
      [404, { error: { message: 'no' } }, /does not know the model/],
      [429, {}, /limit/],
    ] as const) {
      const f = vi.fn(async () => json(body, status))
      await expect(scanReceipt(photo, settings, f as unknown as typeof fetch, 90_000, noWait)).rejects.toThrow(text)
      expect(f).toHaveBeenCalledTimes(1)
    }
  })

  it('retries a dropped connection', async () => {
    const f = vi.fn().mockImplementationOnce(async () => { throw new TypeError('network') }).mockImplementationOnce(async () => json(goodReply, 200))
    const r = await scanReceipt(photo, settings, f as unknown as typeof fetch, 90_000, noWait)
    expect(r.items).toHaveLength(1)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('treats an empty reply as temporary, but a blocked image as final', async () => {
    const empty = vi.fn().mockImplementationOnce(async () => json({ candidates: [] }, 200)).mockImplementationOnce(async () => json(goodReply, 200))
    expect((await scanReceipt(photo, settings, empty as unknown as typeof fetch, 90_000, noWait)).items).toHaveLength(1)
    const blocked = vi.fn(async () => json({ promptFeedback: { blockReason: 'SAFETY' } }, 200))
    await expect(scanReceipt(photo, settings, blocked as unknown as typeof fetch, 90_000, noWait)).rejects.toThrow(/blocked/)
    expect(blocked).toHaveBeenCalledTimes(1)
  })
})
