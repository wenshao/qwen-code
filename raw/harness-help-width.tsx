/** @jsxImportSource @opentui/react */
/* eslint-disable */
/** Width sweep for HelpOverlay under the real renderer. */
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'pr10383-home-'));
mkdirSync(join(HOME, '.qwen'), { recursive: true });
writeFileSync(join(HOME, '.qwen', 'settings.json'), '{}');
process.env['QWEN_HOME'] = HOME;

const { snap, results, OUT } = await import('./render-dialogs.js');
const { HelpOverlay } = await import('../src/ui/opentui/help-overlay.js');
const { computeHelpWidthLayout } = await import(
  '../src/ui/opentui/help-content.js'
);

const fakeCommands = Array.from({ length: 8 }, (_, i) => ({
  name: `cmd${i}`,
  description: `demo command ${i}`,
  kind: 'built-in',
}));

const report: string[] = [];
for (const [term, prop] of [
  [100, 100],
  [100, 98],
  [80, 80],
  [80, 78],
  [72, 72],
  [60, 60],
  [46, 46],
] as Array<[number, number]>) {
  const layout = computeHelpWidthLayout(prop);
  const id = `hw-term${term}-prop${prop}`;
  for (const tab of ['commands', 'general'] as const) {
    await snap(
      `${id}-${tab}`,
      <HelpOverlay
        commands={fakeCommands as never}
        tab={tab}
        scroll={0}
        bodyRows={14}
        width={prop}
      />,
      { width: term, height: 22 },
    );
  }
  report.push(
    `term=${term} prop=${prop} safeWidth=${layout.safeWidth} footprint=${layout.safeWidth + 2} overflow=${layout.safeWidth + 2 - term}`,
  );
}
writeFileSync(join(OUT, 'help-width-report.txt'), report.join('\n'));
console.log(report.join('\n'));
console.log('OUT=' + OUT);
process.exit(0);
