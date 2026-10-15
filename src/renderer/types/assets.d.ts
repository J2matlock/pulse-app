// Images imported from src/renderer/assets: Vite turns them into a URL. The
// renderer has no vite/client types, and a wildcard module has to live in a
// file without imports, so it's here rather than in global.d.ts.
declare module '*.png' {
  const src: string
  export default src
}
