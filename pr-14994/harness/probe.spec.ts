import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  createWebShellDaemonScenario,
  installMockDaemon,
} from './utils/mockDaemon';

test.use({ deviceScaleFactor: 2 });

const workspaceCwd = '/tmp/pr-badge-hover-probe/project';
const sessions = [
  { sessionId: 'pr-branch', displayName: 'Fix sidebar hover shift', branch: true, pr: 14990 },
  { sessionId: 'pr-nobranch', displayName: 'PR without branch icon', branch: false, pr: 14991 },
  { sessionId: 'plain', displayName: 'Plain session', branch: true, pr: 0 },
  { sessionId: 'current', displayName: 'Current', branch: false, pr: 0 },
].map((s) => ({
  sessionId: s.sessionId,
  displayName: s.displayName,
  workspaceCwd,
  clientCount: 0,
  hasActivePrompt: false,
  updatedAt: '2026-10-21T00:00:00.000Z',
  ...(s.branch ? { branch: { name: 'feature/x', baseBranch: 'main' } } : {}),
  ...(s.pr
    ? { prs: [{ number: s.pr, url: `https://github.com/o/r/pull/${s.pr}`, state: 'open' as const }] }
    : {}),
}));

test('probe: PR badge position across row hover', async ({ page }, testInfo) => {
  const scenario = createWebShellDaemonScenario({
    workspaceCwd,
    sessionId: 'current',
    displayName: 'Current',
    sessions,
    capabilities: {
      features: ['session_events', 'session_organization', 'session_archive', 'workspace_session_metadata'],
    },
  });
  await installMockDaemon(page, scenario, { baseURL: String(testInfo.project.use.baseURL) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const out: Record<string, unknown> = {};
  const outDir = process.env.PROBE_OUT!;
  for (const [slug, name] of [['branch', 'Fix sidebar hover shift'], ['nobranch', 'PR without branch icon']] as const) {
    const row = page.locator('[role="button"]').filter({ has: page.locator('[data-web-shell-session-title]', { hasText: name }) }).first();
    await expect(row).toBeVisible();
    const badge = row.locator('a[href^="https://github.com"]');
    await page.mouse.move(700, 400);
    await page.waitForTimeout(250);
    const rest = await badge.boundingBox();
    const rowBox = (await row.boundingBox())!;
    const clip = { x: rowBox.x - 6, y: rowBox.y - 6, width: rowBox.width + 12, height: rowBox.height + 12 };
    await page.screenshot({ path: `${outDir}/${slug}-rest.png`, clip });
    const cx = rest!.x + rest!.width / 2;
    const cy = rest!.y + rest!.height / 2;
    await page.mouse.move(cx, cy - 20);
    await page.mouse.move(cx, cy, { steps: 4 });
    await page.waitForTimeout(250);
    const hover = await badge.boundingBox();
    const under = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const btn = el?.closest('a,button');
      return btn ? `${btn.tagName}:${btn.getAttribute('aria-label') ?? btn.textContent}` : el?.tagName;
    }, [cx, cy]);
    await page.screenshot({ path: `${outDir}/${slug}-hover.png`, clip });
    out[slug] = { restX: rest!.x, hoverX: hover!.x, shift: rest!.x - hover!.x, under, cx, cy, clip };
  }
  writeFileSync(`${outDir}/probe.json`, JSON.stringify(out, null, 2));
  console.log('PROBE ' + JSON.stringify(out));
});
