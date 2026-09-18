import net from 'node:net';
import os from 'node:os';

const COALESCE_MS = Number(process.env.COALESCE_MS ?? '0');
const SCENARIO = process.env.SCENARIO ?? 'claimed';
const TAG = process.env.TAG ?? 'x';
const TARGET = process.env.TARGET_URL ?? 'https://www.saucedemo.com/';
const ENTRY = process.env.RUNTIME_ENTRY;
let coalescedChunks = 0;

if (COALESCE_MS > 0) {
  const origEmit = net.Socket.prototype.emit;
  net.Socket.prototype.emit = function patchedEmit(event, ...args) {
    if (event === 'data' && this._handle?.constructor?.name === 'Pipe') {
      const state = (this.__coalesce ??= { buf: [], timer: null });
      state.buf.push(args[0]);
      if (state.buf.length > 1) coalescedChunks += 1;
      if (state.timer === null) {
        state.timer = setTimeout(() => {
          state.timer = null;
          const merged = Buffer.concat(state.buf);
          state.buf = [];
          origEmit.call(this, 'data', merged);
        }, COALESCE_MS);
      }
      return true;
    }
    return origEmit.call(this, event, ...args);
  };
}

const rows = [];
async function step(name, fn, hangMs = 10_000) {
  const started = Date.now();
  let timer;
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`hang>${hangMs}ms`)), hangMs);
      }),
    ]);
    rows.push([name, 'ok', Date.now() - started]);
    return value;
  } catch (error) {
    const message = String(error?.message ?? error).replace(/\s+/g, ' ');
    rows.push([
      name,
      'FAIL',
      Date.now() - started,
      message.startsWith('hang>') ? `HANG ${message}` : message.slice(0, 170),
    ]);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function report(extra = {}) {
  const line = {
    scenario: SCENARIO,
    coalesceMs: COALESCE_MS,
    tag: TAG,
    coalescedChunks,
    ...extra,
    rows,
  };
  process.stdout.write(
    `load1=${os.loadavg()[0].toFixed(2)} ${JSON.stringify(line)}\n`,
  );
}

let runtime;
try {
  runtime = await import(ENTRY);
} catch (error) {
  rows.push(['import runtime', 'FAIL', 0, String(error?.message ?? error)]);
  report();
  process.exit(2);
}

const agent = await step('setupBrowserRuntime', () => runtime.setupBrowserRuntime(), 60_000);
if (agent === undefined) {
  report();
  await runtime.closeBrowserRuntime?.().catch(() => undefined);
  process.exit(3);
}
const browser = await step('browsers.get(chrome)', () => agent.browsers.get('chrome'), 60_000);
if (browser === undefined) {
  report();
  process.exit(3);
}

let tab;
if (SCENARIO === 'claimed') {
  tab = await step(
    'claimTab',
    async () => {
      const candidates = await browser.user.openTabs();
      const match = candidates.find((candidate) =>
        String(candidate.url ?? '').includes('saucedemo'),
      );
      if (match === undefined) {
        throw new Error('no saucedemo tab among ' + JSON.stringify(candidates));
      }
      return browser.user.claimTab(match);
    },
    25_000,
  );
} else {
  tab = await step(
    'tabs.new + goto',
    async () => {
      const created = await browser.tabs.new();
      await created.goto(TARGET);
      return created;
    },
    40_000,
  );
}

if (tab !== undefined) {
  await step('evaluate before login', () =>
    tab.playwright.evaluate(() => document.readyState),
  );
  if (process.env.BACKGROUND_FIRST === '1') {
    // Inverse experiment: push the claimed (foreground) tab into the
    // background by opening and activating another tab through Chrome's own
    // endpoint, then run the same typing.
    await step('open+activate a blank tab (claimed tab -> background)', async () => {
      const response = await fetch('http://127.0.0.1:9412/json/new?about:blank', { method: 'PUT' });
      if (!response.ok) throw new Error('json/new status ' + response.status);
      return response.status;
    }, 15_000);
  }
  if (process.env.PERKEY === '1') {
    const perKey = [];
    for (const ch of 'secret_sauce') {
      const keyStart = Date.now();
      try {
        await tab.playwright.getByPlaceholder('Password').type(ch, { timeoutMs: 120_000 });
        perKey.push(Date.now() - keyStart);
      } catch (error) {
        perKey.push('FAIL:' + (Date.now() - keyStart));
      }
    }
    rows.push(['per-key x12 (relay)', 'ok', perKey]);
  }
  // Per-key latency of locator.type (pressSequentially) over the relay: the
  // model-driven smoke hit the SDK's default action timeout on a 13-char field.
  await step('type 1 key (timeoutMs 120s)', () =>
    tab.playwright.getByPlaceholder('Username').type('x', { timeoutMs: 120_000 }),
    130_000);
  await step('type 13 keys (timeoutMs 120s)', () =>
    tab.playwright.getByPlaceholder('Password').type('secret_sauce', { timeoutMs: 120_000 }),
    130_000);
  await step('type 13 keys (SDK default timeout)', () =>
    tab.playwright.getByPlaceholder('Password').type('secret_sauce', {}),
    130_000);
  await step('click Password then type 13 keys (default timeout)', async () => {
    await tab.playwright.getByPlaceholder('Password').click();
    await tab.playwright.getByPlaceholder('Password').type('secret_sauce', {});
  }, 130_000);
  {
    const focusInfo = await step('page focus state', () =>
      tab.playwright.evaluate(() => ({
        hasFocus: document.hasFocus(),
        active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
        visibility: document.visibilityState,
      })),
    );
    rows.push(['  -> focus', 'info', JSON.stringify(focusInfo?.value ?? focusInfo ?? null)]);
    // Bring the agent's own tab to the foreground through Chrome's own
    // debugging endpoint (not the relay), then retry the same typing.
    const activated = await step('activate tab via CDP /json/activate', async () => {
      const list = await (await fetch('http://127.0.0.1:9412/json/list')).json();
      const target = list.find((entry) => String(entry.url || '').includes('saucedemo'));
      if (!target) throw new Error('no saucedemo target');
      const response = await fetch('http://127.0.0.1:9412/json/activate/' + target.id);
      return response.status;
    }, 15_000);
    rows.push(['  -> activate status', 'info', String(activated ?? 'n/a')]);
    await step('type 13 keys after activation (default timeout)', () =>
      tab.playwright.getByPlaceholder('Password').type('secret_sauce', {}),
      130_000);
    const focusAfter = await step('page focus state after activation', () =>
      tab.playwright.evaluate(() => ({
        hasFocus: document.hasFocus(),
        visibility: document.visibilityState,
      })),
    );
    rows.push(['  -> focus after', 'info', JSON.stringify(focusAfter?.value ?? focusAfter ?? null)]);
  }
  await step('fill', async () => {
    await tab.playwright.getByPlaceholder('Username').fill('standard_user');
    await tab.playwright.getByPlaceholder('Password').fill('secret_sauce');
  }, 15_000);
  await step(
    'expectNavigation(click Login)',
    () =>
      tab.playwright.expectNavigation(
        () => tab.playwright.getByRole('button', { name: 'Login' }).click(),
        { url: '**/inventory.html', timeoutMs: 12_000 },
      ),
    14_000,
  );
  await step('evaluate after login', () =>
    tab.playwright.evaluate(() => document.querySelectorAll('.inventory_item').length),
  );
  await step('reload()', () => tab.reload(), 20_000);
  await step('evaluate after reload', () =>
    tab.playwright.evaluate(() => document.title),
  );
}

report();
await runtime.closeBrowserRuntime?.().catch(() => undefined);
setTimeout(() => process.exit(0), 300).unref();
