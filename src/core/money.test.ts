import { describe, expect, it } from 'vitest'
import { formatINR, parseINR, parseSignedINR } from './money'

describe('money', () => {
  it('formats with rupee symbol and Indian grouping', () => {
    expect(formatINR(0)).toBe('₹0.00')
    expect(formatINR(123456789)).toBe('₹12,34,567.89')
    expect(formatINR(-5050)).toBe('-₹50.50')
  })
  it('parses user input', () => {
    expect(parseINR('₹1,234.5')).toBe(123450)
    expect(parseINR('10')).toBe(1000)
    expect(parseINR('1.234')).toBeNull()
    expect(parseINR('abc')).toBeNull()
  })
  it('parses discounts with a minus sign', () => {
    expect(parseSignedINR('-50')).toBe(-5000)
    expect(parseSignedINR('−12.5')).toBe(-1250)
    expect(parseSignedINR('40')).toBe(4000)
    expect(parseSignedINR('--5')).toBeNull()
  })
})
