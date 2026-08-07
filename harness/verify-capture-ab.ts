// Compact A/B print for capture: the issue-#8593 flip cells only.
import { impl, IMPL_NAME } from './verify-impl'

function makeApi(fail: { navigate?: boolean } = {}) {
  const calls: any = { create: [], navigate: [], focus: [], hide: [] }
  return {
    calls,
    api: {
      create: async () => { calls.create.push(1); return 'built-in-browser' },
      navigate: async (id: string, url: string) => {
        calls.navigate.push([id, url])
        if (fail.navigate) throw new Error('Navigation timed out after 30s')
        return { url, title: 'T' }
      },
      focus: async () => { calls.focus.push(1) },
      hide: async () => { calls.hide.push(1) },
    },
  }
}

const origWarn = console.warn
const origInfo = console.info
console.warn = () => {}
console.info = () => {}

console.log(IMPL_NAME === 'base'
  ? 'BASE 63a8ed4 (control = inline App.tsx code, verbatim)'
  : 'HEAD b431c76 (PR #8594 extracted module)')
for (const url of ['https://example.com', 'example.com?q=1']) {
  const { api } = makeApi({ navigate: true })
  const external: string[] = []
  await impl(url, { browserPaneApi: api, openExternal: (u: string) => external.push(u) })
  const shown = JSON.stringify(external)
  const tag = external.length === 0 ? '   <-- DEAD CLICK (silent swallow)' : ''
  console.log(`  navigate(${JSON.stringify(url)}) rejects after create`)
  console.log(`    -> openExternal(${shown.length > 46 ? shown.slice(0, 46) : shown})${tag}`)
}
console.warn = origWarn
console.info = origInfo
