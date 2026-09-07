// @vitest-environment jsdom
// Suggested regression guard for #11269 — not part of the PR.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { TodoItem } from '../../adapters/types';
import { I18nProvider } from '../../i18n';
import { TodoPanel } from './TodoPanel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mounted: Array<{ root: Root; container: HTMLElement }> = [];
afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

function render(node: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<I18nProvider language="en">{node}</I18nProvider>));
  mounted.push({ root, container });
  return container;
}

const todos: TodoItem[] = [
  { id: '1', status: 'in_progress', content: 'Apply the fix' },
];

function iconOf(container: HTMLElement) {
  const row = container.querySelector('[role="tooltip"] > div');
  const icon = row?.querySelector('span');
  return {
    spinner: icon?.firstElementChild !== null && icon?.firstElementChild !== undefined,
    glyph: icon?.textContent ?? '',
  };
}

describe('TodoPanel in_progress liveness gate (#11269)', () => {
  it('animates an in_progress item while work is live', () => {
    const icon = iconOf(render(<TodoPanel todos={todos} hasLiveActivity />));
    expect(icon.spinner).toBe(true);
  });

  it('keeps the static glyph when no live work is reported', () => {
    const icon = iconOf(
      render(<TodoPanel todos={todos} hasLiveActivity={false} />),
    );
    expect(icon.spinner).toBe(false);
    expect(icon.glyph).toBe('◐');
  });

  it('defaults to animating so existing callers are unaffected', () => {
    const icon = iconOf(render(<TodoPanel todos={todos} />));
    expect(icon.spinner).toBe(true);
  });
});
