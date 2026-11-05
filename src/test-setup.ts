import { expect } from 'vitest'

// Tiny stand-ins for the two jest-dom matchers the tests use, to avoid another dependency.
expect.extend({
  toBeInTheDocument(received: Element | null) {
    const pass = Boolean(received && received.ownerDocument?.contains(received))
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be in the document` }
  },
  toBeDisabled(received: HTMLElement) {
    const pass = (received as HTMLButtonElement).disabled === true
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be disabled` }
  },
  toBeEnabled(received: HTMLElement) {
    const pass = (received as HTMLButtonElement).disabled === false
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be enabled` }
  },
})

declare module 'vitest' {
  interface Assertion {
    toBeInTheDocument(): void
    toBeDisabled(): void
    toBeEnabled(): void
  }
  interface AsymmetricMatchersContaining {
    toBeInTheDocument(): void
  }
}
