/**
 * One arm of the real-daemon A/B for PR #11269.
 *
 * A real `qwen serve` daemon runs one real session driven by a scripted
 * OpenAI-compatible model: round 1 writes a Todo plan with an `in_progress`
 * item, round 2 stalls, then answers and settles the turn. This script watches
 * the floating Todo panel across that whole turn in one real Web Shell client.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const TOKEN = process.env.QWEN_TOKEN;
const DAEMON = process.env.DAEMON_URL;
const SESSION = process.env.SESSION_ID;
const WS = process.env.WORKSPACE_CWD;
const OUT = process.env.OUT_DIR;
const ARM = process.env.ARM;
const CLIENT = process.env.CLIENT_URL;

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString(), `[${ARM}]`, ...a);

async function liveState() {
  try {
    const r = await fetch(
      `${DAEMON}/workspaces/${encodeURIComponent(WS)}/sessions/live-state`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    const body = await r.json();
    return (body.sessions ?? []).find((s) => s.sessionId === SESSION) ?? null;
  } catch (e) {
    return { error: String(e) };
  }
}

const READ_ICON = () => {
  const rows = Array.from(
    document.querySelectorAll('section [role="tooltip"] > div'),
  );
  const row = rows.find((el) => el.textContent?.includes('Apply the fix'));
  if (!row) return { found: false };
  const icon = row.querySelector('span');
  const child = icon?.firstElementChild;
  const anims = (child ?? icon)
    ? (child ?? icon).getAnimations().map((a) => ({
        name: a.animationName,
        playState: a.playState,
      }))
    : [];
  return {
    found: true,
    glyph: (icon?.textContent ?? '').trim(),
    verdict: child ? 'spinner' : 'static',
    animationVerdict: anims.some(
      (a) =>
        typeof a.name === 'string' &&
        a.name.includes('todoPanelSpin') &&
        a.playState === 'running',
    )
      ? 'running'
      : 'not-running',
  };
};

async function capture(page, phase) {
  const panel = page.locator('section', { hasText: 'Apply the fix' }).last();
  await panel.hover({ timeout: 20000 });
  await page.waitForTimeout(400);
  const state = await page.evaluate(READ_ICON);
  const file = `${OUT}/${ARM}-${phase}.png`;
  await page.screenshot({ path: file });
  return { arm: ARM, phase, state, file };
}

const browser = await chromium.launch();
const results = [];
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') log('console:', m.text().slice(0, 160));
  });
  await page.goto(
    `${CLIENT}/session/${encodeURIComponent(SESSION)}?token=${encodeURIComponent(TOKEN)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('[data-web-shell-root]').waitFor({ timeout: 90000 });
  log('client attached');

  const before = await liveState();
  log('live-state BEFORE:', JSON.stringify(before));

  const editor = page.locator('[data-web-shell-composer-editor] .cm-content');
  await editor.click({ timeout: 40000 });
  await page.keyboard.type('Plan the work, then do it.');
  await page.keyboard.press('Enter');
  log('prompt submitted');

  await page
    .locator('section', { hasText: 'Apply the fix' })
    .last()
    .waitFor({ timeout: 120000 });
  log('todo panel visible');

  const midLive = await liveState();
  log('live-state MID-TURN:', JSON.stringify(midLive));
  results.push(await capture(page, 'mid-turn'));

  // Sample continuously so a flicker cannot hide between two stills.
  const t0 = Date.now();
  const samples = [];
  const live = [];
  let stop = false;
  const sampler = (async () => {
    while (!stop) {
      const at = Date.now() - t0;
      try {
        const st = await page.evaluate(READ_ICON);
        samples.push({ at, v: st.found ? st.verdict : 'absent' });
      } catch {
        samples.push({ at, v: 'error' });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  })();

  const deadline = Date.now() + 180_000;
  let settled = null;
  while (Date.now() < deadline) {
    const s = await liveState();
    live.push({ at: Date.now() - t0, s });
    if (s && s.hasActivePrompt === false) {
      settled = s;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log('daemon reports settled:', JSON.stringify(settled));
  await page.waitForTimeout(8000);
  live.push({ at: Date.now() - t0, s: await liveState() });
  stop = true;
  await sampler;
  const settledLive = await liveState();
  results.push(await capture(page, 'settled'));

  const transitions = [];
  let prev = null;
  for (const s of samples) {
    if (s.v !== prev) {
      transitions.push(s);
      prev = s.v;
    }
  }
  log('icon timeline:', transitions.map((x) => `${x.at}ms=${x.v}`).join(' -> '));
  log(
    'daemon live-state timeline:',
    live
      .map(
        (x) =>
          `${x.at}ms=${x.s ? `prompt:${x.s.hasActivePrompt},work:${x.s.activeWorkState ?? 'absent'}` : 'no-row'}`,
      )
      .join(' | '),
  );

  writeFileSync(
    `${OUT}/real-daemon-${ARM}.json`,
    JSON.stringify({ arm: ARM, before, midLive, settledLive, results, transitions, live, samples }, null, 2),
  );
  for (const r of results) {
    log(`${r.phase.padEnd(9)} -> ${r.state.verdict}/${r.state.animationVerdict} glyph=${JSON.stringify(r.state.glyph)}`);
  }
} finally {
  await browser.close();
}
