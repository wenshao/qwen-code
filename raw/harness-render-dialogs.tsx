/** @jsxImportSource @opentui/react */
/* eslint-disable */
/**
 * PR #10383 real-environment verification harness.
 *
 * Mounts the batch-4 OpenTUI dialogs through the REAL @opentui renderer
 * (native zig/FFI layout + cell buffer, real @opentui/react reconciler,
 * real keyboard pipeline) instead of the DOM-shim fake used by the PR's
 * own .tsx tests, and captures each frame as ANSI + plain text.
 *
 * Runtime: bun (the @opentui native FFI backend requires bun or a node
 * build exposing `node:ffi`, which node 24 does not have).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testRender } from '@opentui/react/test-utils';
import type { TestRendererSetup } from '@opentui/core/testing';
import { framesToAnsi } from './lib.js';

const OUT = process.env['PROBE_OUT'] ?? '/tmp/pr10383-frames';
mkdirSync(OUT, { recursive: true });

const results: Array<{
  id: string;
  ok: boolean;
  note: string;
  rows: number;
  nonEmptyRows: number;
}> = [];

async function snap(
  id: string,
  node: unknown,
  opts: { width?: number; height?: number; keys?: string[][] } = {},
) {
  const width = opts.width ?? 100;
  const height = opts.height ?? 30;
  let t: TestRendererSetup | undefined;
  try {
    t = await testRender(node as never, { width, height });
    await t.flush();
    // let mount effects (async data loads) settle
    await new Promise((r) => setTimeout(r, 120));
    await t.flush();
    const steps = opts.keys ?? [];
    let idx = 0;
    const write = (label: string) => {
      const ansi = framesToAnsi(t!);
      const plain = t!.captureCharFrame();
      const suffix = label ? `.${label}` : '';
      writeFileSync(join(OUT, `${id}${suffix}.ansi`), ansi);
      writeFileSync(join(OUT, `${id}${suffix}.txt`), plain);
      const rows = plain.split('\n');
      results.push({
        id: `${id}${suffix}`,
        ok: rows.some((r) => r.trim().length > 0),
        note: '',
        rows: rows.length,
        nonEmptyRows: rows.filter((r) => r.trim().length > 0).length,
      });
    };
    write('');
    for (const step of steps) {
      idx++;
      for (const k of step) {
        t.mockInput.pressKey(k as never);
        await t.flush();
      }
      await new Promise((r) => setTimeout(r, 60));
      await t.flush();
      write(`k${idx}`);
    }
  } catch (err) {
    results.push({
      id,
      ok: false,
      note: `THREW: ${(err as Error).message}`,
      rows: 0,
      nonEmptyRows: 0,
    });
    writeFileSync(
      join(OUT, `${id}.error.txt`),
      String((err as Error).stack ?? err),
    );
  } finally {
    try {
      (t as unknown as { renderer?: { destroy?: () => void } })?.renderer?.destroy?.();
    } catch {}
  }
}

export { snap, results, OUT };
