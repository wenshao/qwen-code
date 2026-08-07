// Renderer A/B harness for PR #8594.
// Drives the same scenario matrix through the head module (real
// open-url-in-built-in-browser.ts) and the base verbatim control, recording
// every observable: create/navigate/focus/hide calls, openExternal args,
// console output. Expectations are encoded per arm; an expected base
// deficiency (silent swallow) counts as PASS when observed.
import { impl, IMPL_NAME } from './verify-impl'

interface Calls {
  create: any[]
  navigate: any[]
  focus: any[]
  hide: any[]
}

function makeApi(fail: { create?: boolean; navigate?: boolean; focus?: boolean } = {}) {
  const calls: Calls = { create: [], navigate: [], focus: [], hide: [] }
  return {
    calls,
    api: {
      create: async (opts: any) => {
        calls.create.push(opts)
        if (fail.create) throw new Error('no handler for browser-pane:create')
        return 'built-in-browser'
      },
      navigate: async (id: string, url: string) => {
        calls.navigate.push([id, url])
        if (fail.navigate) throw new Error('Navigation timed out after 30s')
        return { url, title: 'T' }
      },
      focus: async (id: string) => {
        calls.focus.push([id])
        if (fail.focus) throw new Error('Focus failed')
      },
      hide: async (id: string) => {
        calls.hide.push([id])
      },
    },
  }
}

interface Expected {
  external: string[]
  createCount: number
  navigateArgs?: any[]
  hideCount?: number
  infoHas?: string
}

interface Scenario {
  name: string
  url: string
  fail?: { create?: boolean; navigate?: boolean; focus?: boolean }
  apiMissing?: boolean
  channel?: boolean // isChannelAvailable result; undefined = no probe passed
  expect: { base: Expected; head: Expected }
}

const scenarios: Scenario[] = [
  {
    name: 'S1 happy https url',
    url: 'https://github.com/QwenLM/qwen-code',
    expect: {
      base: { external: [], createCount: 1, navigateArgs: [['built-in-browser', 'https://github.com/QwenLM/qwen-code']] },
      head: { external: [], createCount: 1, navigateArgs: [['built-in-browser', 'https://github.com/QwenLM/qwen-code']] },
    },
  },
  {
    name: 'S2 create fails (server without pane handlers)',
    url: 'https://example.com',
    fail: { create: true },
    expect: {
      base: { external: ['https://example.com'], createCount: 1 },
      head: { external: ['https://example.com'], createCount: 1 },
    },
  },
  {
    name: 'S3 navigate fails after create (issue #8593 shape)',
    url: 'https://example.com',
    fail: { navigate: true },
    expect: {
      base: { external: [], createCount: 1, hideCount: 0 }, // silent swallow = dead click (expected on base)
      head: { external: ['https://example.com'], createCount: 1, hideCount: 0 },
    },
  },
  {
    name: 'S4 focus fails after navigate',
    url: 'https://example.com',
    fail: { focus: true },
    expect: {
      base: { external: [], createCount: 1 }, // silent swallow (expected on base)
      head: { external: ['https://example.com'], createCount: 1 },
    },
  },
  {
    name: 'S5 bare host with query',
    url: 'example.com?q=1',
    expect: {
      base: { external: [], createCount: 1, navigateArgs: [['built-in-browser', 'example.com?q=1']] },
      head: { external: [], createCount: 1, navigateArgs: [['built-in-browser', 'example.com?q=1']] },
    },
  },
  {
    name: 'S6 localhost with fragment',
    url: 'localhost:3000#docs',
    expect: {
      base: { external: ['localhost:3000#docs'], createCount: 0 }, // base: scheme-like prefix -> external, raw
      head: { external: [], createCount: 1, navigateArgs: [['built-in-browser', 'localhost:3000#docs']] },
    },
  },
  {
    name: 'S7 mailto with surrounding spaces',
    url: '  MAILTO:someone@example.com  ',
    expect: {
      base: { external: ['  MAILTO:someone@example.com  '], createCount: 0 }, // base passes raw untrimmed
      head: { external: ['MAILTO:someone@example.com'], createCount: 0 },
    },
  },
  {
    name: 'S8 api missing, bare host path',
    url: 'localhost:3000/docs',
    apiMissing: true,
    expect: {
      base: { external: ['localhost:3000/docs'], createCount: 0 }, // raw scheme-less to shell.openExternal
      head: { external: ['https://localhost:3000/docs'], createCount: 0 }, // normalized first
    },
  },
  {
    name: 'S9 channel unavailable (headless server)',
    url: '127.0.0.1:3000/docs',
    channel: false,
    // base has no probe; its real-world equivalent is create rejecting (S2 shape),
    // so the base arm here runs with create failing to model the same server.
    fail: { create: true },
    expect: {
      base: { external: ['127.0.0.1:3000/docs'], createCount: 1 }, // attempted then failed, raw url
      head: { external: ['https://127.0.0.1:3000/docs'], createCount: 0, infoHas: 'channel unavailable' }, // pre-check, no create attempt
    },
  },
  {
    name: 'S10 invalid host (port>65535) with secret query',
    url: '192.168.1.1:70000?token=SECRET',
    expect: {
      base: { external: [], createCount: 1, navigateArgs: [['built-in-browser', '192.168.1.1:70000?token=SECRET']] },
      head: { external: [], createCount: 1, navigateArgs: [['built-in-browser', '192.168.1.1:70000?token=SECRET']] },
    },
  },
  {
    name: 'S11 navigate fails on bare host with query',
    url: 'example.com?q=1',
    fail: { navigate: true },
    expect: {
      base: { external: [], createCount: 1 }, // silent swallow (expected on base)
      head: { external: ['https://example.com?q=1'], createCount: 1 }, // normalized, query preserved
    },
  },
  {
    name: 'S12 lone surrogate free text, api missing',
    url: 'search \ud800 term',
    apiMissing: true,
    expect: {
      base: { external: ['search \ud800 term'], createCount: 0 }, // raw, surrogate intact
      head: { external: ['https://duckduckgo.com/?q=search%20%EF%BF%BD%20term'], createCount: 0 },
    },
  },
]

let pass = 0
let fail = 0
const failures: string[] = []

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`ASSERT PASS ${label}: ${a}`)
  } else {
    fail++
    failures.push(label)
    console.log(`ASSERT FAIL ${label}: actual=${a} expected=${e}`)
  }
}

const infoLogs: string[] = []
const origInfo = console.info
const origWarn = console.warn
console.info = (...args: any[]) => { infoLogs.push(args.map(String).join(' ')) }
console.warn = (...args: any[]) => { infoLogs.push(args.map(String).join(' ')) }

console.log(`ARM ${IMPL_NAME}`)
for (const s of scenarios) {
  const { calls, api } = makeApi(s.fail)
  const external: string[] = []
  infoLogs.length = 0
  const opts: any = {
    openExternal: (u: string) => external.push(u),
  }
  if (!s.apiMissing) opts.browserPaneApi = api
  if (s.channel !== undefined) opts.isChannelAvailable = () => s.channel
  await impl(s.url, opts)
  const exp = s.expect[IMPL_NAME as 'base' | 'head']
  assertEq(`${s.name} :: external`, external, exp.external)
  assertEq(`${s.name} :: createCount`, calls.create.length, exp.createCount)
  if (exp.navigateArgs !== undefined) assertEq(`${s.name} :: navigateArgs`, calls.navigate, exp.navigateArgs)
  if (exp.hideCount !== undefined) assertEq(`${s.name} :: hideCount`, calls.hide.length, exp.hideCount)
  if (exp.infoHas !== undefined) {
    const found = infoLogs.some((l) => l.includes(exp.infoHas!))
    assertEq(`${s.name} :: infoLog`, found, true)
  }
}

console.info = origInfo
console.warn = origWarn
console.log(`SUMMARY ${JSON.stringify({ arm: IMPL_NAME, pass, fail })}`)
if (failures.length) console.log(`FAILURES ${JSON.stringify(failures)}`)
process.exit(fail ? 1 : 0)
