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
const rows = [
  'example.com?q=1',
  'localhost:3000#docs',
  '192.168.1.1:70000?token=SECRET',
  '256.1.1.1:8080',
  'search \ud800 term',
  'qwen code docs',
]
console.log(ARM === 'base' ? 'BASE 63a8ed4 main-process navigate()' : 'HEAD b431c76 main-process navigate()')
const manager = new BrowserPaneManager()
for (const input of rows) {
  const id = `c-${rows.indexOf(input)}`
  manager.createInstance(id)
  const instance = (manager as any).instances.get(id)
  const loadURL = instance.pageView.webContents.loadURL
  let out
  try {
    await manager.navigate(id, input)
    out = String(loadURL.mock.calls.at(-1)?.[0] ?? '(no load)')
  } catch (e) {
    out = `THROWS ${(e as Error).constructor.name} -> renderer catches & swallows (dead click)`
  }
  const leak = out.includes('SECRET') ? '  <-- query token LEAKED to search provider' : ''
  const disp = out.length > 66 ? out.slice(0, 66) : out
  console.log(`  ${JSON.stringify(input)}`)
  console.log(`    -> ${disp}${leak}`)
}
