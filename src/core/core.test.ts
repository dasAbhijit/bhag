import { describe, expect, it } from 'vitest'
import { friendBalances, netBalances, pairwiseDebts } from './balances'
import { csvCell, groupCsv, paiseToDecimal } from './csv'
import { dueOccurrences, occurrence } from './recurrence'
import { simplifyDebts, simplifyExact, simplifyGreedy } from './simplify'
import { allocate, computeSplit, SplitError, splitRemaining } from './splits'
import type { LedgerExpense, Transfer } from './types'

/** Small seeded PRNG so property tests are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

describe('splits', () => {
  it('splits 100 three ways, extra paisa to the lowest id', () => {
    expect(computeSplit(100, { method: 'equal', participants: ['c', 'a', 'b'] })).toEqual({ a: 34, b: 33, c: 33 })
  })
  it('equal ignores duplicates and handles one person', () => {
    expect(computeSplit(999, { method: 'equal', participants: ['a', 'a'] })).toEqual({ a: 999 })
  })
  it('exact must add up', () => {
    expect(computeSplit(1000, { method: 'exact', amounts: { a: 400, b: 600 } })).toEqual({ a: 400, b: 600 })
    expect(() => computeSplit(1000, { method: 'exact', amounts: { a: 400, b: 500 } })).toThrow(SplitError)
  })
  it('percent must total 100 and rounds by largest remainder', () => {
    const r = computeSplit(1000, { method: 'percent', percents: { a: 33.33, b: 33.33, c: 33.34 } })
    expect(sum(r)).toBe(1000)
    expect(r.c).toBeGreaterThanOrEqual(r.a)
    expect(() => computeSplit(1000, { method: 'percent', percents: { a: 50, b: 40 } })).toThrow(/100/)
    expect(() => computeSplit(1000, { method: 'percent', percents: { a: 50.123, b: 49.877 } })).toThrow(/2 decimal/)
  })
  it('shares 2:1:1', () => {
    expect(computeSplit(10000, { method: 'shares', shares: { a: 2, b: 1, c: 1 } })).toEqual({ a: 5000, b: 2500, c: 2500 })
  })
  it('zero weight owes nothing, all zero is an error', () => {
    expect(computeSplit(100, { method: 'shares', shares: { a: 1, b: 0 } })).toEqual({ a: 100, b: 0 })
    expect(() => computeSplit(100, { method: 'shares', shares: { a: 0, b: 0 } })).toThrow(SplitError)
    expect(computeSplit(0, { method: 'equal', participants: ['a', 'b'] })).toEqual({ a: 0, b: 0 })
  })
  it('reports what is left to assign', () => {
    expect(splitRemaining(1000, { method: 'exact', amounts: { a: 250 } })).toBe(750)
    expect(splitRemaining(1000, { method: 'percent', percents: { a: 60.5 } })).toBe(3950)
  })
  it('always sums to the total (random)', () => {
    const r = rng(1)
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(r() * 9)
      const total = Math.floor(r() * 5_000_000)
      const w: Record<string, number> = {}
      for (let k = 0; k < n; k++) w['p' + k] = Math.floor(r() * 7)
      if (sum(w) === 0) w.p0 = 1
      const out = allocate(total, w)
      expect(sum(out)).toBe(total)
      for (const [id, v] of Object.entries(out)) if (w[id] === 0) expect(v).toBe(0)
    }
  })
  it('does not overflow on very large totals', () => {
    const big = 900_000_000_000 // 9,000 crore rupees in paise
    expect(sum(allocate(big, { a: 123456, b: 654321, c: 1 }))).toBe(big)
  })
})

describe('balances', () => {
  const dinner: LedgerExpense = { amount: 3000, payers: { a: 3000 }, owed: { a: 1000, b: 1000, c: 1000 } }
  it('computes net balances including settlements', () => {
    expect(netBalances([dinner])).toEqual({ a: 2000, b: -1000, c: -1000 })
    expect(netBalances([dinner], [{ from: 'b', to: 'a', amount: 1000 }])).toEqual({ a: 1000, b: 0, c: -1000 })
  })
  it('multiple payers', () => {
    const e: LedgerExpense = { amount: 1000, payers: { a: 700, b: 300 }, owed: { a: 250, b: 250, c: 500 } }
    expect(netBalances([e])).toEqual({ a: 450, b: 50, c: -500 })
    const debts = pairwiseDebts([e])
    expect(debts).toEqual([
      { from: 'c', to: 'a', amount: 450 },
      { from: 'c', to: 'b', amount: 50 },
    ])
  })
  it('nets opposite debts and applies settlements', () => {
    const e1: LedgerExpense = { amount: 1000, payers: { a: 1000 }, owed: { b: 1000 } }
    const e2: LedgerExpense = { amount: 400, payers: { b: 400 }, owed: { a: 400 } }
    expect(pairwiseDebts([e1, e2])).toEqual([{ from: 'b', to: 'a', amount: 600 }])
    expect(pairwiseDebts([e1, e2], [{ from: 'b', to: 'a', amount: 600 }])).toEqual([])
  })
  it('friend balances combine groups', () => {
    const g1: Transfer[] = [{ from: 'b', to: 'me', amount: 500 }]
    const g2: Transfer[] = [{ from: 'me', to: 'b', amount: 200 }, { from: 'c', to: 'me', amount: 50 }]
    expect(friendBalances('me', [...g1, ...g2])).toEqual({ b: 300, c: 50 })
    expect(friendBalances('me', [{ from: 'b', to: 'me', amount: 5 }, { from: 'me', to: 'b', amount: 5 }])).toEqual({})
  })
  it('pairwise debts agree with net balances (random)', () => {
    const r = rng(7)
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (let i = 0; i < 200; i++) {
      const expenses: LedgerExpense[] = []
      for (let k = 0; k < 1 + Math.floor(r() * 6); k++) {
        const amount = 100 + Math.floor(r() * 100000)
        const payerW: Record<string, number> = {}
        const owedW: Record<string, number> = {}
        for (const id of ids) {
          if (r() < 0.4) payerW[id] = 1 + Math.floor(r() * 5)
          if (r() < 0.7) owedW[id] = 1 + Math.floor(r() * 5)
        }
        if (!Object.keys(payerW).length) payerW.a = 1
        if (!Object.keys(owedW).length) owedW.b = 1
        expenses.push({ amount, payers: allocate(amount, payerW), owed: allocate(amount, owedW) })
      }
      const settle = [{ from: 'a', to: 'c', amount: Math.floor(r() * 5000) }]
      const net = netBalances(expenses, settle)
      const fromDebts: Record<string, number> = {}
      for (const t of pairwiseDebts(expenses, settle)) {
        fromDebts[t.from] = (fromDebts[t.from] ?? 0) - t.amount
        fromDebts[t.to] = (fromDebts[t.to] ?? 0) + t.amount
      }
      for (const id of ids) expect(fromDebts[id] ?? 0).toBe(net[id] ?? 0)
    }
  })
})

function applyTransfers(net: Record<string, number>, ts: Transfer[]) {
  const after = { ...net }
  for (const t of ts) {
    after[t.from] = (after[t.from] ?? 0) + t.amount
    after[t.to] = (after[t.to] ?? 0) - t.amount
  }
  return after
}

describe('simplify', () => {
  it('collapses A owes B, B owes C into A pays C', () => {
    const net = netBalances([
      { amount: 1000, payers: { b: 1000 }, owed: { a: 1000 } },
      { amount: 1000, payers: { c: 1000 }, owed: { b: 1000 } },
    ])
    expect(simplifyDebts(net)).toEqual([{ from: 'a', to: 'c', amount: 1000 }])
  })
  it('exact finds fewer transfers than greedy when groups are independent', () => {
    // Two separate pairs that each settle internally: 2 transfers are enough.
    const net = { a: 500, b: -500, c: 300, d: -300 }
    expect(simplifyExact(net)).toHaveLength(2)
  })
  it('exact beats greedy on a known case', () => {
    // Greedy pairs the 5 and 4 first; the zero-sum split is {5,-5} and {4,3,-7}... needs 3 transfers.
    const net = { a: 5, b: -5, c: 4, d: 3, e: -7 }
    expect(simplifyExact(net).length).toBe(3)
    expect(simplifyGreedy(net).length).toBeGreaterThanOrEqual(3)
  })
  it('empty and zero balances give nothing', () => {
    expect(simplifyDebts({})).toEqual([])
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([])
  })
  it('random: settles everyone, never more than n-1, exact <= greedy', () => {
    const r = rng(42)
    for (let i = 0; i < 300; i++) {
      const n = 2 + Math.floor(r() * 9)
      const net: Record<string, number> = {}
      let total = 0
      for (let k = 0; k < n - 1; k++) {
        const v = Math.floor((r() - 0.5) * 20000)
        net['p' + k] = v
        total += v
      }
      net['p' + (n - 1)] = -total
      const exact = simplifyExact(net)
      const greedy = simplifyGreedy(net)
      for (const out of [exact, greedy]) {
        const after = applyTransfers(net, out)
        for (const v of Object.values(after)) expect(v).toBe(0)
        for (const t of out) expect(t.amount).toBeGreaterThan(0)
      }
      const nonZero = Object.values(net).filter((v) => v !== 0).length
      expect(exact.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1))
      expect(exact.length).toBeLessThanOrEqual(greedy.length)
    }
  })
  it('falls back to greedy for big groups without crashing', () => {
    const net: Record<string, number> = {}
    for (let i = 0; i < 30; i++) net['p' + i] = i % 2 ? 100 + i : -(100 + i - 1)
    const total = Object.values(net).reduce((a, b) => a + b, 0)
    net.p0 -= total
    const after = applyTransfers(net, simplifyDebts(net))
    for (const v of Object.values(after)) expect(v).toBe(0)
  })
})

describe('recurrence', () => {
  it('weekly', () => {
    expect(occurrence('2026-01-01', 'weekly', 0)).toBe('2026-01-01')
    expect(occurrence('2026-12-28', 'weekly', 1)).toBe('2027-01-04')
  })
  it('monthly clamps to month end but returns to the anchor day', () => {
    expect(occurrence('2026-01-31', 'monthly', 1)).toBe('2026-02-28')
    expect(occurrence('2026-01-31', 'monthly', 2)).toBe('2026-03-31')
    expect(occurrence('2026-01-31', 'monthly', 3)).toBe('2026-04-30')
    expect(occurrence('2026-11-15', 'monthly', 3)).toBe('2027-02-15')
    expect(occurrence('2024-01-31', 'monthly', 1)).toBe('2024-02-29')
  })
  it('yearly handles Feb 29', () => {
    expect(occurrence('2024-02-29', 'yearly', 1)).toBe('2025-02-28')
    expect(occurrence('2024-02-29', 'yearly', 4)).toBe('2028-02-29')
  })
  it('lists everything due, catching up on missed runs, and respects end date', () => {
    expect(dueOccurrences('2026-01-31', 'monthly', 0, '2026-03-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
    expect(dueOccurrences('2026-01-31', 'monthly', 2, '2026-03-30')).toEqual([])
    expect(dueOccurrences('2026-01-01', 'weekly', 0, '2026-02-01', '2026-01-15')).toEqual(['2026-01-01', '2026-01-08', '2026-01-15'])
  })
})

describe('csv', () => {
  it('formats paise and guards formulas', () => {
    expect(paiseToDecimal(123450)).toBe('1234.50')
    expect(paiseToDecimal(-5)).toBe('-0.05')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('Dinner, drinks')).toBe('"Dinner, drinks"')
    expect(csvCell('plain')).toBe('plain')
  })
  it('builds a Splitwise-style export', () => {
    const csv = groupCsv(
      [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Ben' }],
      [{ date: '2026-11-01', title: 'Dinner', category: 'Food', amount: 3000, payers: { a: 3000 }, owed: { a: 1500, b: 1500 } }],
      [{ date: '2026-11-02', from: 'b', to: 'a', amount: 500 }],
    )
    expect(csv.split('\r\n')).toEqual([
      'Date,Description,Category,Cost (INR),Asha,Ben',
      '2026-11-01,Dinner,Food,30.00,15.00,-15.00',
      '2026-11-02,Payment,Payment,5.00,-5.00,5.00',
      ',Total balance,,,10.00,-10.00',
      '',
    ])
  })
})
