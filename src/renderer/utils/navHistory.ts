/**
 * Where the user came from, so "Back" can go there and say so (audit 3.18 /
 * N-14, R-20). The top bar records each page as it's shown; pages read the
 * one before.
 */
const visited: string[] = []

/** Record a page (called by the top bar on every page change) */
export function notePage(path: string): void {
  if (visited[visited.length - 1] === path) return
  visited.push(path)
  if (visited.length > 50) visited.shift()
}

/** The page shown before this one, if any */
export function previousPage(current: string): string | null {
  for (let i = visited.length - 1; i >= 0; i--) {
    if (visited[i] !== current) return visited[i]!
  }
  return null
}

/** True when there's in-app history to go back through */
export function canGoBack(): boolean {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' && idx > 0
}

/** For tests */
export function resetNavHistory(): void { visited.length = 0 }
