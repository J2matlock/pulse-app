/**
 * Mock for 'electron-store' — in-memory key-value store for tests.
 */
export default class Store {
  private data = new Map<string, unknown>()

  constructor(_opts?: unknown) {}

  get(key: string, defaultValue?: unknown): unknown {
    return this.data.has(key) ? this.data.get(key) : defaultValue
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }

  has(key: string): boolean {
    return this.data.has(key)
  }

  delete(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }
}
