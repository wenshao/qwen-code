// Main-process navigate() A/B harness for PR #8594.
// The electron/logger/browser-cdp mock block below is copied VERBATIM from the PR's own
// src/main/__tests__/browser-pane-manager.test.ts (lines 9-269), with only the mock.module
// specifiers re-rooted ('../logger' -> './src/main/logger', '../browser-cdp' -> './src/main/browser-cdp').
import { mock } from 'bun:test'


const createdWindows: any[] = []
let toolbarLoadFailuresRemaining = 0
let emptyStateLoadError: unknown = null
const pageLoadErrorsByUrl = new Map<string, unknown[]>()
const mockShellOpenExternal = mock(async () => {})
const mockIpcMainHandle = mock(() => {})

function createMockWebContents() {
  const listeners: Record<string, Function[]> = {}
  let currentUrl = 'about:blank'
  return {
    userAgent: 'Mock Chrome Electron/99.0.0',
    session: {},
    on: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    loadURL: mock(async (url: string) => {
      const isToolbarUrl = typeof url === 'string' && url.includes('browser-toolbar.html')
      if (isToolbarUrl && toolbarLoadFailuresRemaining > 0) {
        toolbarLoadFailuresRemaining--
        throw new Error('mock toolbar load failure')
      }
      const pageLoadErrors = pageLoadErrorsByUrl.get(url)
      const pageLoadError = pageLoadErrors?.shift()
      if (pageLoadError) throw pageLoadError
      currentUrl = url
    }),
    loadFile: mock(async (_path: string, _opts?: unknown) => {
      if (_path.includes('browser-empty-state.html') && emptyStateLoadError) {
        const error = emptyStateLoadError
        emptyStateLoadError = null
        throw error
      }
      if (toolbarLoadFailuresRemaining > 0) {
        toolbarLoadFailuresRemaining--
        throw new Error('mock toolbar load failure')
      }
    }),
    getTitle: mock(() => 'Test Page'),
    getURL: mock(() => currentUrl),
    canGoBack: mock(() => false),
    canGoForward: mock(() => false),
    isDestroyed: mock(() => false),
    insertCSS: mock(async (_css: string, _opts?: unknown) => 'mock-css-key'),
    removeInsertedCSS: mock(async (_key: string) => {}),
    goBack: mock(() => {}),
    goForward: mock(() => {}),
    reload: mock(() => {}),
    stop: mock(() => {}),
    setUserAgent: mock(() => {}),
    setBackgroundColor: mock(() => {}),
    capturePage: mock(async () => {
      const img = {
        isEmpty: () => false,
        getSize: () => ({ width: 2400, height: 1800 }),
        resize: (_opts: any) => img,
        toPNG: () => Buffer.from('fake-png'),
        toJPEG: (_quality: number) => Buffer.from('fake-jpeg'),
      }
      return img
    }),
    executeJavaScript: mock(async (expr: string) => eval(expr)),
    focus: mock(() => {}),
    setWindowOpenHandler: mock((_handler: any) => {}),
    send: mock((_channel: string, _payload?: unknown) => {}),
    debugger: {
      attach: mock(() => {}),
      detach: mock(() => {}),
      sendCommand: mock(async () => ({ nodes: [] })),
      on: mock(() => {}),
    },
    _listeners: listeners,
    _emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] || []) cb({}, ...args)
    },
  }
}

function createMockView(withWebContents = false) {
  const children: any[] = []
  const view: any = {
    setBounds: mock(() => {}),
    setBackgroundColor: mock(() => {}),
    setBorderRadius: mock(() => {}),
    addChildView: mock((child: any) => {
      const existingIndex = children.indexOf(child)
      if (existingIndex >= 0) children.splice(existingIndex, 1)
      children.push(child)
    }),
    removeChildView: mock((child: any) => {
      const existingIndex = children.indexOf(child)
      if (existingIndex >= 0) children.splice(existingIndex, 1)
    }),
    children,
  }
  if (withWebContents) {
    view.webContents = createMockWebContents()
  }
  return view
}

function createMockWindow(opts?: { width?: number; height?: number; minWidth?: number; minHeight?: number }) {
  const listeners: Record<string, Function[]> = {}
  const webContents = createMockWebContents()
  const contentView = createMockView()
  let contentWidth = opts?.width ?? 1200
  let contentHeight = opts?.height ?? 900
  const minWidth = opts?.minWidth ?? 0
  const minHeight = opts?.minHeight ?? 0

  const win = {
    webContents,
    contentView,
    on: (event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    },
    once: (event: string, cb: Function) => {
      const wrapped = (...args: any[]) => {
        listeners[event] = (listeners[event] || []).filter(fn => fn !== wrapped)
        cb(...args)
      }
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(wrapped)
    },
    _emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] || []) cb(...args)
    },
    isDestroyed: mock(() => false),
    isMinimized: mock(() => false),
    isVisible: mock(() => false),
    restore: mock(() => {}),
    show: mock(() => {}),
    showInactive: mock(() => {}),
    setWindowButtonVisibility: mock((_visible: boolean) => {}),
    hide: mock(() => {
      win._emit('hide')
    }),
    focus: mock(() => {}),
    destroy: mock(() => {
      win._emit('closed')
    }),
    getContentSize: mock(() => [contentWidth, contentHeight]),
    setContentSize: mock((width: number, height: number) => {
      contentWidth = Math.max(minWidth, Math.floor(width))
      contentHeight = Math.max(minHeight, Math.floor(height))
    }),
    loadURL: mock(async (_url: string) => {}),
  }
  createdWindows.push(win)
  return win
}

mock.module('electron', () => ({
  BrowserWindow: class MockBrowserWindow {
    webContents: any
    constructor(opts?: any) {
      const win = createMockWindow(opts)
      this.webContents = win.webContents
      Object.assign(this, win)
    }
  },
  View: class MockView {
    constructor() {
      Object.assign(this, createMockView())
    }
  },
  WebContentsView: class MockWebContentsView {
    webContents: any
    constructor(_opts?: any) {
      const view = createMockView(true)
      this.webContents = view.webContents
      Object.assign(this, view)
    }
  },
  ipcMain: {
    handle: mockIpcMainHandle,
  },
  Menu: {
    buildFromTemplate: mock(() => ({
      popup: mock(() => {}),
    })),
  },
  nativeTheme: {
    shouldUseDarkColors: false,
  },
  shell: {
    openExternal: mockShellOpenExternal,
  },
  app: {
    getPath: mock(() => '/tmp'),
  },
  session: {
    fromPartition: mock(() => ({
      setPermissionCheckHandler: mock(() => {}),
      setPermissionRequestHandler: mock(() => {}),
      webRequest: {
        onBeforeRequest: mock((_cb: any) => {}),
        onCompleted: mock((_cb: any) => {}),
        onErrorOccurred: mock((_cb: any) => {}),
      },
      on: mock((_event: string, _cb: any) => {}),
    })),
  },
}))

mock.module('./src/main/logger', () => {
  const stubLog = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    agentLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
  }
})

mock.module('./src/main/browser-cdp', () => ({
  BrowserCDP: class MockBrowserCDP {
    detach = mock(() => {})
    getAccessibilitySnapshot = mock(async () => ({
      url: 'https://example.com',
      title: 'Example',
      nodes: [],
    }))
    clickElement = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    fillElement = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    selectOption = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    renderTemporaryOverlay = mock(async () => {})
    clearTemporaryOverlay = mock(async () => {})
    getViewportMetrics = mock(async () => ({ width: 1200, height: 900, dpr: 2, scrollX: 0, scrollY: 0 }))
    getElementGeometry = mock(async () => ({
      ref: '@e1',
      box: { x: 0, y: 0, width: 10, height: 10 },
      clickPoint: { x: 5, y: 5 },
    }))
    getElementGeometryBySelector = mock(async () => ({
      ref: 'selector:div.card',
      box: { x: 5, y: 5, width: 20, height: 20 },
      clickPoint: { x: 15, y: 15 },
    }))
  },
}))


const { BrowserPaneManager } = await import('./src/main/browser-pane-manager')

const ARM = process.env.ARM
if (ARM !== 'base' && ARM !== 'head') throw new Error('ARM env required')

const DDG = 'https://duckduckgo.com/?q='
const REJECT_URI = '__REJECT_URIError__'

const matrix: Array<{ input: string; base: string; head: string }> = [
  { input: 'https://github.com/QwenLM/qwen-code', base: 'https://github.com/QwenLM/qwen-code', head: 'https://github.com/QwenLM/qwen-code' },
  { input: 'example.com?q=1', base: `${DDG}example.com%3Fq%3D1`, head: 'https://example.com?q=1' },
  { input: 'localhost:3000#docs', base: `${DDG}localhost%3A3000%23docs`, head: 'https://localhost:3000#docs' },
  { input: '192.168.1.1:70000?token=SECRET', base: `${DDG}192.168.1.1%3A70000%3Ftoken%3DSECRET`, head: `${DDG}192.168.1.1%3A70000` },
  { input: '256.1.1.1:8080', base: 'https://256.1.1.1:8080', head: `${DDG}256.1.1.1%3A8080` },
  { input: 'localhost:70000', base: 'https://localhost:70000', head: `${DDG}localhost%3A70000` },
  { input: 'search \ud800 term', base: REJECT_URI, head: `${DDG}search%20%EF%BF%BD%20term` },
  { input: 'qwen code docs', base: `${DDG}qwen%20code%20docs`, head: `${DDG}qwen%20code%20docs` },
  { input: 'example.com/docs', base: 'https://example.com/docs', head: 'https://example.com/docs' },
  { input: 'about:blank', base: 'about:blank', head: 'about:blank' },
  { input: '10.0.0.1', base: 'https://10.0.0.1', head: 'https://10.0.0.1' },
  { input: 'mailto:x@y.z', base: `${DDG}mailto%3Ax%40y.z`, head: `${DDG}mailto%3Ax%40y.z` },
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

console.log(`ARM ${ARM}`)
const manager = new BrowserPaneManager()
for (const row of matrix) {
  const id = `m-${matrix.indexOf(row)}`
  manager.createInstance(id)
  const instance = (manager as any).instances.get(id)
  const loadURL = instance.pageView.webContents.loadURL
  let outcome: string
  try {
    await manager.navigate(id, row.input)
    outcome = loadURL.mock.calls.length ? String(loadURL.mock.calls.at(-1)?.[0]) : '__NO_LOAD__'
  } catch (error) {
    outcome = error instanceof URIError ? REJECT_URI : `__REJECT_${(error as Error).constructor.name}__`
  }
  assertEq(`navigate(${JSON.stringify(row.input)})`, outcome, row[ARM])
}

// Secret-leak probe: on the invalid-host input, the URL handed to Chromium must
// not carry the query token. Encoded as its own assertion so the head arm proves
// the hardening and the base arm documents the leak it replaces.
{
  const id = 'secret-probe'
  manager.createInstance(id)
  const instance = (manager as any).instances.get(id)
  const loadURL = instance.pageView.webContents.loadURL
  await manager.navigate(id, '192.168.1.1:70000?token=SECRET')
  const sent = String(loadURL.mock.calls.at(-1)?.[0] ?? '')
  const leaked = sent.includes('SECRET')
  assertEq('secret query token reaches search provider', leaked, ARM === 'base')
}

console.log(`SUMMARY ${JSON.stringify({ arm: ARM, pass, fail })}`)
if (failures.length) console.log(`FAILURES ${JSON.stringify(failures)}`)
process.exit(fail ? 1 : 0)
