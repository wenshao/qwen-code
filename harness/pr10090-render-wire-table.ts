#!/usr/bin/env npx tsx
/**
 * Render the PR #10090 wire-evidence comparison (base / head / witness) as a
 * terminal screenshot, using the repo's own xterm.js + Playwright capture.
 *
 * Usage (from the repo root):
 *   PR10090_DIR=/path/with/pr10090-{base,head,witness} \
 *   npx tsx integration-tests/terminal-capture/pr10090-render-wire-table.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { TerminalCapture } from './terminal-capture.js';

const ESC = '\u001B';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RED = `${ESC}[38;5;203m`;
const GREEN = `${ESC}[38;5;114m`;
const YELLOW = `${ESC}[38;5;221m`;
const CYAN = `${ESC}[38;5;117m`;
const GREY = `${ESC}[38;5;245m`;

type Evidence = {
  label: string;
  probes: Array<{
    id: string;
    title: string;
    args: Record<string, unknown>;
    toolResult: string | null;
  }>;
};

/** Unwrap the OpenAI content-part array the CLI sends for a tool result. */
function plainText(raw: string | null): string {
  if (raw === null) return '<no result>';
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((p) => (typeof p?.text === 'string' ? p.text : JSON.stringify(p)))
        .join(' ');
    }
  } catch {
    // Not JSON — fall through and print it verbatim.
  }
  return raw;
}

function load(dir: string, label: string): Evidence {
  return JSON.parse(
    readFileSync(join(dir, `pr10090-${label}`, 'evidence.json'), 'utf8'),
  ) as Evidence;
}

async function main(): Promise<void> {
  const dir = resolve(process.env['PR10090_DIR'] ?? tmpdir());
  const outputDir = resolve(
    process.env['PR10090_OUT'] ?? join(tmpdir(), 'pr10090-wire-table'),
  );
  mkdirSync(outputDir, { recursive: true });

  const base = load(dir, 'base');
  const head = load(dir, 'head');
  const witness = load(dir, 'witness');

  const lines: string[] = [];
  lines.push(
    `${BOLD}PR #10090 — what the MODEL actually receives as the send_message tool result${RESET}`,
  );
  lines.push(
    `${GREY}bundled dist/cli.js · real team (leader + qa-reviewer) · captured off the wire${RESET}`,
  );
  lines.push('');

  for (let i = 0; i < head.probes.length; i += 1) {
    const probe = head.probes[i];
    const b = plainText(base.probes[i]?.toolResult ?? null);
    const h = plainText(probe.toolResult ?? null);
    const w = plainText(witness.probes[i]?.toolResult ?? null);

    const changed = b !== h;
    const witnessAdds = h !== w;
    const tag = changed
      ? `${GREEN}CHANGED${RESET}`
      : witnessAdds
        ? `${RED}NO CHANGE${RESET}`
        : `${GREY}no change${RESET}`;

    lines.push(
      `${BOLD}${CYAN}${probe.id}${RESET}  ${DIM}${probe.title}${RESET}  [${tag}]`,
    );
    lines.push(`  ${GREY}args    ${RESET} ${JSON.stringify(probe.args)}`);
    lines.push(`  ${GREY}base    ${RESET} ${b}`);
    const headColor = changed ? GREEN : witnessAdds ? RED : GREY;
    lines.push(`  ${GREY}PR head ${RESET} ${headColor}${h}${RESET}`);
    if (witnessAdds) {
      lines.push(`  ${GREY}witness ${RESET} ${YELLOW}${w}${RESET}`);
    }
    lines.push('');
  }

  lines.push(
    `${GREY}witness = PR head + one line: append the same hint to error.message${RESET}`,
  );

  const ansiPath = join(outputDir, 'wire-table.ansi');
  writeFileSync(ansiPath, lines.join('\n') + '\n', 'utf8');
  console.log('wrote', ansiPath, `(${lines.length} lines)`);

  const terminal = await TerminalCapture.create({
    cols: 132,
    rows: lines.length + 2,
    cwd: resolve(process.cwd()),
    outputDir,
    title: 'PR #10090 wire evidence',
    theme: 'github-dark',
    chrome: false,
    fontSize: 14,
  });
  try {
    await terminal.spawn('bash', ['-c', `cat ${JSON.stringify(ansiPath)}`]);
    await terminal.idle(800, 15000);
    const png = await terminal.capture('pr10090-wire-table.png', outputDir);
    console.log('captured', png);
  } finally {
    await terminal.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
