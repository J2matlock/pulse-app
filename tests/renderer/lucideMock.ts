/**
 * Catch-all lucide-react mock: every icon renders nothing. Use as
 *   vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
 * so adding an icon to a component never breaks unrelated tests.
 */
const Icon = () => null
export const lucideMock: Record<string, unknown> = new Proxy({}, {
  get: (_t, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : prop === '__esModule' ? true : Icon),
  has: (_t, prop) => prop !== 'then',
})
