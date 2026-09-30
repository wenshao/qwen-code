// Rig driver for PR #13081 real-stack verification on Linux.
// REAL daemon (`qwen serve --web`) + REAL session + turns driven through the
// browser composer against a local OpenAI-compatible stub (the only mock is
// the model itself). The trajectory panel then renders REAL transcript replay
// with REAL ui_telemetry timing frames — the exact "real daemon session"
// coverage the PR lists as not validated.
//
// Modes:
//   RIG_MODE=turns   create the session and drive 5 turns (turn 4 fans out
//                    two parallel read_file calls). Idempotent: skips if the
//                    transcript already has the final answer of turn 5.
//   RIG_MODE=after   verification scenarios against the PR build (+ shots).
//   RIG_MODE=before  same probes against the merge-base client build: the
//                    waterfall/fold affordances must be ABSENT.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.RIG_BASE ?? 'http://127.0.0.1:13081';
const OUT = process.env.RIG_OUT ?? '/root/rig13081/shots';
const MODE = process.env.RIG_MODE ?? 'after';
const STATE = '/root/rig13081/out';
const TURNS = 5;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(STATE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { mode: MODE, checks: [] };
const check = (name, ok, extra = '') => {
  report.checks.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
};

async function createSession() {
  const res = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: '/root/rig13081/workspace' }),
  });
  if (!res.ok) throw new Error(`POST /session -> ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const id = data.sessionId ?? data.id ?? data.session?.id;
  if (!id) throw new Error(`no session id in ${JSON.stringify(data).slice(0, 300)}`);
  fs.writeFileSync(`${STATE}/session-id.txt`, id);
  console.log(`session: ${id}`);
  return id;
}

function sessionId() {
  return fs.readFileSync(`${STATE}/session-id.txt`, 'utf8').trim();
}

async function main() {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const newPage = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 240)}`);
    });
    page.on('pageerror', (e) => console.log(`[pageerror] ${String(e).slice(0, 240)}`));
    return page;
  };

  const openSession = async (page, id) => {
    await page.goto(`${BASE}/session/${encodeURIComponent(id)}`);
    await page.waitForSelector('[data-web-shell-composer-editor] .cm-content', { timeout: 30000 });
    await page.getByText('Loading...').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
    await sleep(500);
  };

  const submitPrompt = async (page, text) => {
    const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
    await editor.click();
    await editor.fill(text);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
  };

  const openTrajectory = async (page) => {
    await page.getByRole('button', { name: /Toggle right panel|切换右侧扩展区/ }).click();
    await page.getByTestId('right-panel-open-trajectory').click();
    const grid = page.getByTestId('trajectory-rows');
    await grid.waitFor({ state: 'visible', timeout: 20000 });
    // Wait until transcript pages finish loading: at least one request row.
    await page.getByTestId('trajectory-row-request').first().waitFor({ timeout: 20000 });
    await sleep(600);
    return grid;
  };

  const resizePanel = async (page, width) => {
    const panel = page.getByTestId('trajectory-panel');
    const current = (await panel.boundingBox()).width;
    const handle = (await page.locator('[role="separator"][aria-orientation="vertical"]').last().boundingBox());
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + current - width, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    const deadline = Date.now() + 5000;
    let w = 0;
    while (Date.now() < deadline) {
      w = Math.round((await panel.boundingBox()).width);
      if (Math.abs(w - width) <= 2) break;
      await sleep(100);
    }
    return w;
  };

  // ---------- mode: turns ----------
  if (MODE === 'turns') {
    const id = await createSession();
    const page = await newPage(1600, 900);
    await openSession(page, id);
    for (let turn = 1; turn <= TURNS; turn += 1) {
      const marker = `Turn ${turn} done`;
      const already = await page.getByText(marker, { exact: false }).count();
      if (already > 0) {
        console.log(`turn ${turn} already complete, skipping`);
        continue;
      }
      await submitPrompt(page, `Turn ${turn}: please read the note file${turn % 4 === 0 ? 's' : ''}.`);
      await page.getByText(marker, { exact: false }).first().waitFor({ timeout: 90000 });
      console.log(`turn ${turn} complete`);
      await sleep(800); // let telemetry flush
    }
    await page.screenshot({ path: `${OUT}/turns-chat-final.png` });
    await page.context().close();
    await browser.close();
    return;
  }

  const id = sessionId();

  // ---------- shared probes ----------
  const probeWide = async (tag) => {
    const page = await newPage(2400, 900);
    await openSession(page, id);
    const grid = await openTrajectory(page);
    const panelW = await resizePanel(page, 960);
    const rows = await page.locator('[data-testid="trajectory-rows"] [role="row"]').count();
    const rowcount = await grid.getAttribute('aria-rowcount');
    const cells = page.getByTestId('trajectory-waterfall-cell');
    const cellCount = await cells.count();
    const cellVisible = cellCount > 0 ? await cells.first().isVisible() : false;
    const spans = await page.getByTestId('trajectory-waterfall-span').count();
    const folds = await page.getByRole('button', { name: /^Collapse / }).count();
    const metrics = (await page.getByTestId('trajectory-metrics').textContent())?.trim();
    const overviewSpans = await page.locator('[data-testid="trajectory-overview"] [data-testid="trajectory-span"]').count();
    const plot = page.getByTestId('trajectory-plot');
    const plotDomain = `${await plot.getAttribute('data-from')}..${await plot.getAttribute('data-to')}`;
    check(`${tag}.panel-resized-960`, Math.abs(panelW - 960) <= 2, `w=${panelW}`);
    check(`${tag}.rows-mounted`, rows > 0, `mounted=${rows} aria-rowcount=${rowcount}`);
    check(`${tag}.overview-spans`, overviewSpans > 0, `count=${overviewSpans} domain=${plotDomain}`);
    await page.screenshot({ path: `${OUT}/${tag}-wide-960.png` });
    return { page, grid, rows, rowcount, cellCount, cellVisible, spans, folds, metrics, plotDomain };
  };

  if (MODE === 'before') {
    const w = await probeWide('before');
    check('before.no-waterfall-cells', w.cellCount === 0, `cells=${w.cellCount}`);
    check('before.no-waterfall-spans', w.spans === 0, `spans=${w.spans}`);
    check('before.no-fold-buttons', w.folds === 0, `folds=${w.folds}`);
    console.log(`before metrics: ${w.metrics}`);
    fs.writeFileSync(`${STATE}/before-probe.json`, JSON.stringify(w.metrics));
    await w.page.context().close();
    await browser.close();
    fs.writeFileSync(`${STATE}/report-before.json`, JSON.stringify(report, null, 2));
    return;
  }

  // ---------- MODE=after ----------

  // s1: wide waterfall against REAL timing frames
  const s1 = await probeWide('after');
  check('after.waterfall-cells-visible', s1.cellVisible && s1.cellCount > 0, `cells=${s1.cellCount}`);
  check('after.waterfall-spans-real', s1.spans >= TURNS * 2, `spans=${s1.spans} (>= 2/turn: request+tool)`);
  check('after.fold-buttons-present', s1.folds >= TURNS, `folds=${s1.folds}`);
  console.log(`after metrics: ${s1.metrics} domain=${s1.plotDomain}`);
  const page = s1.page;
  const grid = s1.grid;

  // Waterfall and overview share the time domain (real data).
  const cell = page.getByTestId('trajectory-waterfall-cell').last();
  const plot = page.getByTestId('trajectory-plot');
  const cellFrom = await cell.getAttribute('data-from');
  const cellTo = await cell.getAttribute('data-to');
  check('after.shared-domain', cellFrom === (await plot.getAttribute('data-from')) && cellTo === (await plot.getAttribute('data-to')), `cell=${cellFrom}..${cellTo}`);

  // s2: fold a turn group; full-window metrics must not move.
  // NOTE: mounted row count is virtualization-dependent (it can RISE when
  // rows shrink); aria-rowcount is the ground truth.
  const rowcount = async () => Number(await grid.getAttribute('aria-rowcount'));
  const foldAllTurns = async () => {
    let btns = page.getByRole('button', { name: /^Collapse Turn / });
    while ((await btns.count()) > 0) {
      await btns.first().click();
      await sleep(180);
      btns = page.getByRole('button', { name: /^Collapse Turn / });
    }
  };
  const rc0 = await rowcount();
  await page.getByRole('button', { name: /^Collapse Turn / }).first().click();
  await sleep(400);
  const rc1 = await rowcount();
  const collapsedBadge = await page.getByText(/records collapsed|条记录/).count();
  const metricsAfterFold = (await page.getByTestId('trajectory-metrics').textContent())?.trim();
  check('after.fold-hides-rows', rc1 < rc0, `aria-rowcount ${rc0} -> ${rc1}`);
  check('after.fold-badge', collapsedBadge > 0, `badges=${collapsedBadge}`);
  check('after.fold-metrics-stable', metricsAfterFold === s1.metrics, 'totals unchanged');
  await page.screenshot({ path: `${OUT}/after-fold-turn.png` });
  await page.getByRole('button', { name: /^Expand Turn / }).first().click();
  await sleep(400);
  check('after.expand-restores-rows', (await rowcount()) === rc0, `aria-rowcount back to ${await rowcount()}`);

  // s3: inspector stays on the same tool while its turn folds; reveal.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const tool = page.getByTestId('trajectory-row-tool').last();
  const toolKey = await tool.getAttribute('data-row-key');
  await tool.scrollIntoViewIfNeeded();
  await tool.click();
  await page.getByRole('button', { name: 'View details' }).click();
  const inspector = page.getByTestId('trajectory-inspector');
  await inspector.waitFor({ state: 'visible' });
  await inspector.getByRole('button', { name: 'Input', exact: true }).click();
  const inputBefore = await inspector.locator('pre').textContent();
  // Fold EVERY turn: the selected tool's ancestors must collapse too.
  await foldAllTurns();
  await sleep(400);
  const noticeShown = await inspector.getByText(/group containing this record is collapsed|所在分组已折叠/).count();
  const inputAfter = await inspector.locator('pre').textContent();
  const metricsAllFolded = (await page.getByTestId('trajectory-metrics').textContent())?.trim();
  check('after.fold-keeps-inspector', noticeShown > 0 && inputAfter === inputBefore, `notice=${noticeShown} input=${JSON.stringify((inputAfter ?? '').slice(0, 60))}`);
  check('after.foldall-metrics-stable', metricsAllFolded === s1.metrics, 'totals unchanged with all turns folded');
  const rcAllFolded = await rowcount();
  await page.screenshot({ path: `${OUT}/after-inspector-folded.png` });
  await inspector.getByRole('button', { name: /Expand and locate|展开并定位/ }).click();
  await sleep(600);
  const revealed = await page.locator(`[data-row-key="${toolKey}"][data-selected="true"]`).count();
  const rcRevealed = await rowcount();
  check('after.expand-and-locate', revealed === 1 && rcRevealed > rcAllFolded, `toolKey=${toolKey} rowcount ${rcAllFolded} -> ${rcRevealed}`);
  await page.screenshot({ path: `${OUT}/after-expand-locate.png` });
  await inspector.getByRole('button', { name: /Close|关闭/ }).first().click().catch(() => {});

  // s4: select a hidden record in the overview -> ancestors expand, row revealed.
  await foldAllTurns();
  await sleep(300);
  const rowsAllFolded = await rowcount();
  const spanToClick = page.locator('[data-testid="trajectory-overview"] [data-testid="trajectory-span"]').nth(2);
  await spanToClick.click();
  await sleep(600);
  const rowsAfterReveal = await rowcount();
  const active = await grid.getAttribute('aria-activedescendant');
  const activeMounted = active ? await page.locator(`[id="${active}"]`).count() : 0;
  check('after.all-turns-folded', rowsAllFolded <= TURNS + 1, `aria-rowcount=${rowsAllFolded}`);
  check('after.overview-reveal-expands', rowsAfterReveal > rowsAllFolded, `${rowsAllFolded} -> ${rowsAfterReveal}`);
  check('after.active-row-mounted', activeMounted === 1, `active=${active}`);
  await page.screenshot({ path: `${OUT}/after-overview-reveal.png` });

  // s5: keyboard navigation follows visible rows.
  await grid.focus();
  await page.keyboard.press('End');
  await sleep(200);
  const endActive = await grid.getAttribute('aria-activedescendant');
  await page.keyboard.press('Home');
  await sleep(200);
  const homeActive = await grid.getAttribute('aria-activedescendant');
  await page.keyboard.press('ArrowDown');
  await sleep(200);
  const downActive = await grid.getAttribute('aria-activedescendant');
  const homeMounted = homeActive ? await page.locator(`[id="${homeActive}"]`).count() : 0;
  check('after.keyboard-home-end', endActive !== homeActive && homeMounted === 1 && downActive !== homeActive, `home=${homeActive} end=${endActive} down=${downActive}`);

  // s6: zoom via wheel on the overview; waterfall keeps the shared domain.
  const plotBox = (await plot.boundingBox());
  const toBefore = Number(await plot.getAttribute('data-to'));
  await page.mouse.move(plotBox.x + plotBox.width * 0.8, plotBox.y + plotBox.height / 2);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -240);
  await sleep(500);
  const span2 = Number(await plot.getAttribute('data-to')) - Number(await plot.getAttribute('data-from'));
  const cellTo2 = await cell.getAttribute('data-to');
  check('after.zoom-shares-domain', span2 < toBefore * 0.6 && cellTo2 === (await plot.getAttribute('data-to')), `span=${Math.round(span2)} cellTo=${cellTo2}`);
  await page.screenshot({ path: `${OUT}/after-zoomed.png` });
  await page.getByRole('button', { name: 'Show the whole run', exact: true }).click();
  await sleep(400);

  // s7: mode switch active <-> real time keeps both plots on one domain.
  await page.getByTestId('trajectory-mode-clock').click();
  await sleep(400);
  const clockFrom = await plot.getAttribute('data-from');
  const cellToClock = await cell.getAttribute('data-to');
  check('after.clock-mode-shared', clockFrom === '0' && cellToClock === (await plot.getAttribute('data-to')), `from=${clockFrom} cellTo=${cellToClock}`);
  await page.screenshot({ path: `${OUT}/after-clock-mode.png` });
  await page.getByTestId('trajectory-mode-active').click();
  await sleep(300);

  // s8: narrow panel (480px then 320px): waterfall hides, folding survives.
  const w480 = await resizePanel(page, 480);
  await sleep(300);
  const cellVisible480 = await page.getByTestId('trajectory-waterfall-cell').first().isVisible().catch(() => false);
  check('after.waterfall-hidden-480', !cellVisible480 && Math.abs(w480 - 480) <= 2, `w=${w480}`);
  await page.screenshot({ path: `${OUT}/after-narrow-480.png` });
  const w320 = await resizePanel(page, 320);
  await sleep(300);
  const folds320 = await page.locator('[data-testid="trajectory-rows"] button[aria-expanded]').count();
  const rowsVisible320 = await page.locator('[data-testid="trajectory-rows"] [role="row"]').count();
  check('after.fold-available-320', folds320 > 0 && rowsVisible320 > 0 && Math.abs(w320 - 320) <= 2, `w=${w320} foldBtns=${folds320} rows=${rowsVisible320}`);
  await page.screenshot({ path: `${OUT}/after-narrow-320.png` });
  await resizePanel(page, 960);

  // s9: short window 1600x600 keeps inspector + copy reachable (PR test 4).
  // Expand every turn first so the last tool row exists in the list.
  let xp = page.getByRole('button', { name: /^Expand Turn / });
  while ((await xp.count()) > 0) {
    await xp.first().click();
    await sleep(150);
    xp = page.getByRole('button', { name: /^Expand Turn / });
  }
  await page.setViewportSize({ width: 1600, height: 600 });
  await sleep(400);
  const toolRow = page.getByTestId('trajectory-row-tool').last();
  await toolRow.scrollIntoViewIfNeeded();
  await toolRow.click();
  await page.getByRole('button', { name: 'View details' }).click();
  const inspector2 = page.getByTestId('trajectory-inspector');
  await inspector2.getByRole('button', { name: 'Input', exact: true }).click();
  const copyBtn = inspector2.getByRole('button', { name: 'Copy displayed content' });
  const panelBox = (await page.getByTestId('trajectory-panel').boundingBox());
  await page.mouse.move(panelBox.x + 20, panelBox.y + 20);
  await page.mouse.wheel(0, 600);
  await sleep(400);
  const copyVisible = await copyBtn.isVisible().catch(() => false);
  await copyBtn.click().catch(() => {});
  const statusText = await inspector2.getByRole('status').textContent().catch(() => '');
  check('after.short-window-copy', copyVisible && /Copied|已复制/.test(statusText ?? ''), `status=${JSON.stringify(statusText)}`);
  await page.screenshot({ path: `${OUT}/after-short-1600x600.png` });

  await page.context().close();
  await browser.close();
  fs.writeFileSync(`${STATE}/report-after.json`, JSON.stringify(report, null, 2));
  const failed = report.checks.filter((c) => !c.ok);
  console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
