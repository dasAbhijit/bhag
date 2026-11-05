import { describe, expect, it } from 'vitest'
import { itemisedSplit, itemsSubtotal } from './itemised'
import { SplitError } from './splits'

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)

describe('itemised split', () => {
  it('shares each item among the people who had it', () => {
    const { owed, total } = itemisedSplit([
      { name: 'Paneer tikka', amount: 30000, members: ['a', 'b'] },
      { name: 'Dosa', amount: 12000, members: ['c'] },
      { name: 'Lassi x3', amount: 21000, members: ['a', 'b', 'c'] },
    ])
    expect(owed).toEqual({ a: 15000 + 7000, b: 15000 + 7000, c: 12000 + 7000 })
    expect(total).toBe(63000)
  })

  it('shares tax and tip in proportion to each person', () => {
    // a had 300, b had 100. 40 of tax and tip is split 30 / 10.
    const { owed, total } = itemisedSplit(
      [{ name: 'Thali', amount: 30000, members: ['a'] }, { name: 'Roti', amount: 10000, members: ['b'] }],
      4000,
    )
    expect(owed).toEqual({ a: 33000, b: 11000 })
    expect(total).toBe(44000)
  })

  it('applies a discount in proportion', () => {
    const { owed, total } = itemisedSplit(
      [{ name: 'A', amount: 30000, members: ['a'] }, { name: 'B', amount: 10000, members: ['b'] }],
      -4000,
    )
    expect(owed).toEqual({ a: 27000, b: 9000 })
    expect(total).toBe(36000)
  })

  it('a person with no items pays no part of the charges', () => {
    const { owed } = itemisedSplit([{ name: 'A', amount: 10000, members: ['a'] }], 1800)
    expect(owed).toEqual({ a: 11800 })
  })

  it('rejects bad input with a clear message', () => {
    expect(() => itemisedSplit([])).toThrow(/at least one item/)
    expect(() => itemisedSplit([{ name: 'Tea', amount: 1000, members: [] }])).toThrow(/Choose who had “Tea”/)
    expect(() => itemisedSplit([{ name: 'Tea', amount: -5, members: ['a'] }])).toThrow(SplitError)
    expect(() => itemisedSplit([{ name: 'Tea', amount: 1000, members: ['a'] }], -1000)).toThrow(/more than zero/)
    expect(() => itemisedSplit([{ name: 'Tea', amount: 0, members: ['a'] }], 500)).toThrow(/at least one item with an amount/)
  })

  it('always adds up exactly (random)', () => {
    let seed = 99
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (let i = 0; i < 400; i++) {
      const items = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, k) => {
        const members = ids.filter(() => r() < 0.5)
        return { name: 'i' + k, amount: Math.floor(r() * 90000), members: members.length ? members : ['a'] }
      })
      const sub = itemsSubtotal(items)
      if (sub === 0) continue
      const extra = Math.floor((r() - 0.3) * sub * 0.4)
      const { owed, total } = itemisedSplit(items, extra)
      expect(sum(owed)).toBe(total)
      expect(total).toBe(sub + extra)
      for (const v of Object.values(owed)) expect(v).toBeGreaterThanOrEqual(0)
    }
  })
})
