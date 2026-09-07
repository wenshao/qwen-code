/**
 * PR #11269 verification harness — "gate todo spinner on live work".
 *
 * Drives the real Web Shell client (real App, real session-catalog store, real
 * hooks, real TodoPanel.module.css) in real Chromium against the wire-level
 * mock daemon, and records, per scenario, whether the floating Todo panel's
 * `in_progress` row renders a *running* CSS animation or the static glyph.
 *
 * The same file runs unchanged on both arms:
 *   ARM=base  -> PR #11267 head (this PR's merge base)
 *   ARM=head  -> PR #11269 head
 * so the matrix it writes is a like-for-like A/B.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DaemonSessionSummary } from '@qwen-code/sdk/daemon';
import {
  createWebShellDaemonScenario,
  installMockDaemon,
  replayCompleteEvent,
  toolCallEvent,
  userTextEvent,
  type MockDaemonController,
  type WebShellDaemonScenario,
} from './utils/mockDaemon';

const ARM = process.env['TODO_LIVENESS_ARM'] ?? 'unknown';
const OUT_DIR =
  process.env['TODO_LIVENESS_OUT'] ?? join(process.cwd(), 'todo-liveness-out');

const WORKSPACE = '/tmp/qwen-web-shell-e2e';
const SESSION = 'web-shell-e2e-session';

const LIVE_STATE_FEATURES = [
  'session_events',
  'session_source_metadata',
  'workspace_session_live_state',
];
const NO_LIVE_STATE_FEATURES = ['session_events', 'session_source_metadata'];

/**
 * A settled turn that left a persisted `in_progress` Todo behind: the
 * todo_write tool call itself is `completed`, so nothing in the transcript is
 * running and the local streaming state is `idle`. This is exactly the state
 * #11119 describes.
 */
function settledTranscript() {
  return [
    userTextEvent('Do the thing', { id: 1 }),
    toolCallEvent(
      'todo-1',
      'todo_write',
      {
        todos: [
          { id: 'a', content: 'Read the code', status: 'completed' },
          { id: 'b', content: 'Apply the fix', status: 'in_progress' },
          { id: 'c', content: 'Run the tests', status: 'pending' },
        ],
      },
      { id: 2 },
    ),
  ];
}

/**
 * Scenario A starts with no plan on screen; the live turn is driven for real
 * (composer submit -> POST /session/:id/prompt -> the agent's todo_write
 * arrives over SSE, no turn_complete). A stale running tool block cannot be
 * used to fake this: `selectDaemonStreamingState` returns `idle` whenever the
 * daemon's promptStatus is idle, so only an actually in-flight prompt puts
 * `streamingState` at non-idle.
 */
function preTurnTranscript() {
  return [userTextEvent('Earlier question', { id: 1 })];
}

function liveTodoWriteEvent(id: number) {
  return toolCallEvent(
    'todo-live',
    'todo_write',
    {
      todos: [
        { id: 'a', content: 'Read the code', status: 'completed' },
        { id: 'b', content: 'Apply the fix', status: 'in_progress' },
        { id: 'c', content: 'Run the tests', status: 'pending' },
      ],
    },
    { id },
  );
}

interface LiveRow {
  hasActivePrompt: boolean;
  activeWorkState?: DaemonSessionSummary['activeWorkState'];
}

interface Scenario {
  id: string;
  label: string;
  features: string[];
  row: LiveRow;
  /** Submit a prompt so the client's own streamingState leaves `idle`. */
  localStream?: boolean;
  expected: { base: 'spinner' | 'static'; head: 'spinner' | 'static' };
}

const SCENARIOS: Scenario[] = [
  {
    id: 'A-local-stream',
    label: 'local turn streaming (daemon says idle)',
    features: LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false, activeWorkState: 'idle' },
    localStream: true,
    expected: { base: 'spinner', head: 'spinner' },
  },
  {
    id: 'B-daemon-prompt',
    label: 'daemon reports hasActivePrompt (silent foreground turn)',
    features: LIVE_STATE_FEATURES,
    row: { hasActivePrompt: true, activeWorkState: 'idle' },
    expected: { base: 'spinner', head: 'spinner' },
  },
  {
    id: 'C-active-work',
    label: 'foreground settled, activeWorkState=active (background hold)',
    features: LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false, activeWorkState: 'active' },
    expected: { base: 'spinner', head: 'spinner' },
  },
  {
    id: 'D-idle-work',
    label: 'everything settled, activeWorkState=idle  <-- the bug',
    features: LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false, activeWorkState: 'idle' },
    expected: { base: 'spinner', head: 'static' },
  },
  {
    id: 'E-legacy-daemon',
    label: 'older daemon: live-state omits activeWorkState entirely',
    features: LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false },
    expected: { base: 'spinner', head: 'static' },
  },
  {
    id: 'F-unknown-work',
    label: 'activeWorkState=unknown (bridge cannot answer)',
    features: LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false, activeWorkState: 'unknown' },
    expected: { base: 'spinner', head: 'static' },
  },
  {
    id: 'G-catalog-fallback-idle',
    label: 'no live-state capability: catalog row, activeWorkState=idle',
    features: NO_LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false, activeWorkState: 'idle' },
    expected: { base: 'spinner', head: 'static' },
  },
  {
    id: 'H-catalog-fallback-active',
    label: 'no live-state capability: catalog row, activeWorkState=active',
    features: NO_LIVE_STATE_FEATURES,
    row: { hasActivePrompt: false, activeWorkState: 'active' },
    expected: { base: 'spinner', head: 'spinner' },
  },
];

function scenarioFor(sc: Scenario): WebShellDaemonScenario {
  const summary = {
    sessionId: SESSION,
    workspaceCwd: WORKSPACE,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    displayName: 'E2E Harness Session',
    clientCount: 1,
    hasActivePrompt: sc.row.hasActivePrompt,
    ...(sc.row.activeWorkState !== undefined
      ? { activeWorkState: sc.row.activeWorkState }
      : {}),
  } as DaemonSessionSummary;
  return createWebShellDaemonScenario({
    workspaceCwd: WORKSPACE,
    sessionId: SESSION,
    events: sc.localStream ? preTurnTranscript() : settledTranscript(),
    sessions: [summary],
    capabilities: { features: sc.features },
  });
}

async function completeReplay(
  page: Page,
  daemon: MockDaemonController,
  scenario: WebShellDaemonScenario,
): Promise<void> {
  const connection = await daemon.sse.waitForConnection(scenario.sessionId);
  await daemon.sendEvent(
    replayCompleteEvent({
      sessionId: connection.sessionId,
      replayedCount: scenario.events.length,
    }),
  );
  await expect(page.getByText('Loading...')).toHaveCount(0);
}

/**
 * Ground truth read off the live document, not off React props: is the
 * `in_progress` row's icon a *running* CSS animation, or the static glyph?
 * `getAnimations()` is the browser's own answer, so a spinner element that
 * rendered but never animates cannot pass as one, and vice versa.
 */
async function readIconState(page: Page) {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('section [role="tooltip"] > div'),
    );
    const row = rows.find((el) => el.textContent?.includes('Apply the fix'));
    if (!row) return { found: false } as const;
    const icon = row.querySelector('span');
    const child = icon?.firstElementChild as HTMLElement | null;
    const animations = (child ?? icon)
      ? (child ?? icon)!
          .getAnimations()
          .map((a) => ({
            name: (a as unknown as { animationName?: string }).animationName,
            playState: a.playState,
          }))
      : [];
    // CSS modules hash the keyframe name (e.g. `_todoPanelSpin_t0z44_1`),
    // so match on the substring rather than the authored identifier.
    const running = animations.filter(
      (a) =>
        typeof a.name === 'string' &&
        a.name.includes('todoPanelSpin') &&
        a.playState === 'running',
    );
    const target = (child ?? icon) as HTMLElement | null;
    const computed = target ? getComputedStyle(target) : null;
    return {
      found: true,
      glyph: (icon?.textContent ?? '').trim(),
      hasSpinnerElement: child !== null,
      spinnerClass: child?.className ?? null,
      animationName: computed?.animationName ?? null,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches,
      animations,
      // Structural verdict: did TodoPanel render the spinner element at all?
      // That is the branch this PR gates. The animation readings above say
      // whether the browser is actually animating it.
      verdict: child !== null ? 'spinner' : 'static',
      animationVerdict: running.length > 0 ? 'running' : 'not-running',
    } as const;
  });
}

const results: Array<Record<string, unknown>> = [];

test.afterAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, `matrix-${ARM}.json`),
    JSON.stringify({ arm: ARM, results }, null, 2),
  );
});

test.use({ reducedMotion: 'no-preference' });

for (const sc of SCENARIOS) {
  test(`todo spinner :: ${sc.id} :: ${sc.label}`, async ({
    page,
  }, testInfo: TestInfo) => {
    const scenario = scenarioFor(sc);
    const daemon = await installMockDaemon(page, scenario, {
      baseURL: String(testInfo.project.use.baseURL),
    });

    await page.goto(`/session/${encodeURIComponent(scenario.sessionId)}`);
    await expect(page.locator('[data-web-shell-root]')).toBeVisible();
    await completeReplay(page, daemon, scenario);

    if (sc.localStream) {
      const editor = page.locator(
        '[data-web-shell-composer-editor] .cm-content',
      );
      await editor.click();
      await page.keyboard.type('do the thing');
      await page.keyboard.press('Enter');
      await expect
        .poll(
          () =>
            daemon.requests.filter((r) =>
              /\/session\/[^/]+\/prompt\/?$/.test(r.path),
            ).length,
        )
        .toBeGreaterThan(0);
      // The agent's plan lands mid-turn; the mock never sends turn_complete,
      // so the turn stays in flight exactly like a real one still working.
      await daemon.sendEvent(liveTodoWriteEvent(10));
    }

    // The floating panel's detail list (which holds the per-item icons) is
    // revealed on hover, exactly as a user sees it.
    const panel = page.locator('section', { hasText: 'Apply the fix' }).last();
    await expect(panel).toBeVisible();
    await panel.hover();
    await expect(page.getByText('Apply the fix')).toBeVisible();

    // Give the live-state poll time to land and any re-render to settle.
    await page.waitForTimeout(1500);

    const state = await readIconState(page);
    const shotDir = join(OUT_DIR, ARM);
    mkdirSync(shotDir, { recursive: true });
    const shot = join(shotDir, `${sc.id}.png`);
    await panel.screenshot({ path: shot });
    const fullShot = join(shotDir, `${sc.id}-full.png`);
    await page.screenshot({ path: fullShot });

    results.push({
      arm: ARM,
      id: sc.id,
      label: sc.label,
      features: sc.features,
      row: sc.row,
      localStream: sc.localStream === true,
      observed: state,
      expected: sc.expected[ARM as 'base' | 'head'],
      screenshot: shot,
    });

    expect(state.found).toBe(true);
    expect(state.verdict).toBe(sc.expected[ARM as 'base' | 'head']);
  });
}
