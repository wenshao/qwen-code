// Vacuity / mutation harness for PR #8594 (runs inside the HEAD worktree).
// Applies single-point mutations to the PR's production code, reruns the PR's
// own test files, and checks the expected tests go red. Restores the pristine
// file after each mutation. M2 is the positive control (must be caught).
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const RENDERER = 'src/renderer/components/app-shell/open-url-in-built-in-browser.ts'
const MAIN = 'src/main/browser-pane-manager.ts'
const RENDERER_TEST = 'src/renderer/components/app-shell/__tests__/open-url-in-built-in-browser.test.ts'
const MAIN_TEST = 'src/main/__tests__/browser-pane-manager.test.ts'

const mutations = [
  {
    id: 'M1',
    desc: 'catch swallows again (base behavior restored): remove openExternal from catch',
    file: RENDERER,
    test: RENDERER_TEST,
    search: "      error,\n    )\n    openExternal(externalUrl)\n  }",
    replace: "      error,\n    )\n  }",
    expectTestsFail: true,
  },
  {
    id: 'M2',
    desc: 'POSITIVE CONTROL: shouldUseBuiltInBrowser always true',
    file: RENDERER,
    test: RENDERER_TEST,
    search:
      '  return (\n    HOST_PATTERN.test(trimmedUrl) ||\n    !EXPLICIT_SCHEME_PATTERN.test(trimmedUrl) ||\n    /^https?:\\/\\//i.test(trimmedUrl)\n  )',
    replace: '  return true',
    expectTestsFail: true,
  },
  {
    id: 'M3',
    desc: 'drop toWellFormed() in free-text search branch',
    file: RENDERER,
    test: RENDERER_TEST,
    search: 'encodeURIComponent(trimmedUrl.toWellFormed())',
    replace: 'encodeURIComponent(trimmedUrl)',
    expectTestsFail: true,
  },
  {
    id: 'M4',
    desc: 'drop new URL validation for host-like candidates',
    file: RENDERER,
    test: RENDERER_TEST,
    search:
      '    const candidate = `https://${trimmedUrl}`\n    try {\n      new URL(candidate)\n      return candidate\n    } catch {\n      const host = trimmedUrl.split(/[/?#]/, 1)[0]\n      return `https://duckduckgo.com/?q=${encodeURIComponent(host.toWellFormed())}`\n    }',
    replace: '    return `https://${trimmedUrl}`',
    expectTestsFail: true,
  },
  {
    id: 'M5',
    desc: 'main: host pattern back to (?:\\/|$) (pre-alignment)',
    file: MAIN,
    test: MAIN_TEST,
    search: '(?::\\d+)?(?:[/?#]|$)',
    replace: '(?::\\d+)?(?:\\/|$)',
    expectTestsFail: true,
  },
  {
    id: 'M6',
    desc: 'main: invalid-host fallback searches full input (token leak returns)',
    file: MAIN,
    test: MAIN_TEST,
    search:
      '          const host = normalizedUrl.split(/[/?#]/, 1)[0]\n          normalizedUrl = `https://duckduckgo.com/?q=${encodeURIComponent(host)}`',
    replace:
      '          normalizedUrl = `https://duckduckgo.com/?q=${encodeURIComponent(normalizedUrl)}`',
    expectTestsFail: true,
  },
]

const pristine = new Map()
for (const m of mutations) {
  if (!pristine.has(m.file)) pristine.set(m.file, readFileSync(m.file, 'utf8'))
}

console.log('mutation-id | result | tests(fail/pass) | verdict')
for (const m of mutations) {
  const src = pristine.get(m.file)
  if (!src.includes(m.search)) {
    console.log(`${m.id} | MUTATION DID NOT APPLY (search string absent) | - | HARNESS-ERROR`)
    continue
  }
  writeFileSync(m.file, src.replace(m.search, m.replace))
  let out = ''
  let code = 0
  try {
    out = execFileSync('bun', ['test', m.test], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 })
  } catch (e) {
    code = e.status ?? 1
    out = (e.stdout ?? '') + (e.stderr ?? '')
  } finally {
    writeFileSync(m.file, pristine.get(m.file))
  }
  const passMatch = out.match(/(\d+) pass/)
  const failMatch = out.match(/(\d+) fail/)
  const nPass = passMatch ? Number(passMatch[1]) : -1
  const nFail = failMatch ? Number(failMatch[1]) : -1
  const killed = code !== 0 && nFail > 0
  const verdict = killed === m.expectTestsFail ? 'EXPECTED' : 'SURVIVED-UNEXPECTEDLY'
  console.log(`${m.id} | ${killed ? 'killed (suite red)' : 'survived (suite green)'} | ${nFail} fail / ${nPass} pass | ${verdict}`)
  // show which tests failed, for attribution
  const names = [...out.matchAll(/\(fail\) ([^\[]+)/g)].map((x) => x[1].trim())
  if (names.length) console.log(`     failing: ${[...new Set(names)].join(' ; ')}`)
}
// sanity: pristine restored?
for (const [f, content] of pristine) {
  if (readFileSync(f, 'utf8') !== content) console.log(`RESTORE-FAILED: ${f}`)
}
console.log('RESTORE-OK')
