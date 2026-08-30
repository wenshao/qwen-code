/* Real-render harness helpers: capture OpenTUI frames as ANSI + plain text. */
import type { TestRendererSetup } from '@opentui/core/testing';

const ESC = String.fromCharCode(27);

function to255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v <= 1 ? v * 255 : v)));
}

/** Convert a captured span frame into a true-color ANSI string. */
export function framesToAnsi(t: TestRendererSetup): string {
  const frame = t.captureSpans();
  const out: string[] = [];
  for (const line of frame.lines) {
    let row = '';
    for (const span of line.spans) {
      const f = span.fg as unknown as { r: number; g: number; b: number };
      const b = span.bg as unknown as {
        r: number;
        g: number;
        b: number;
        a?: number;
      };
      // Reset first: a span with a transparent bg must not inherit the
      // previous span's background.
      let codes = `0;38;2;${to255(f.r)};${to255(f.g)};${to255(f.b)}`;
      if (b.a === undefined || b.a > 0.01) {
        codes += `;48;2;${to255(b.r)};${to255(b.g)};${to255(b.b)}`;
      }
      if (span.attributes & 1) codes += ';1';
      if (span.attributes & 2) codes += ';2';
      if (span.attributes & 4) codes += ';3';
      if (span.attributes & 8) codes += ';4';
      row += `${ESC}[${codes}m${span.text}`;
    }
    out.push(row + `${ESC}[0m`);
  }
  return out.join('\n');
}
