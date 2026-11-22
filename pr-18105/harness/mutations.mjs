export function ruleBlock(text, selector) {
  const start = text.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  const end = text.indexOf('\n}', start);
  return { start: start + 1, end: end + 2, text: text.slice(start + 1, end + 2) };
}

export function replaceInBlock(text, selector, from, to) {
  const b = ruleBlock(text, selector);
  if (!b.text.includes(from)) throw new Error(`snippet not found in ${selector}: ${from}`);
  const next = b.text.replace(from, to);
  return text.slice(0, b.start) + next + text.slice(b.end);
}

export const mutations = {
  'C0-unmutated': (t) => t,
  'M1-running-token-to-blue': (t) =>
    replaceInBlock(t, '.sessionStatusDotRunning', 'color: var(--success-color, #3fb950);', 'color: var(--agent-blue-500);'),
  'M2-running-color-deleted': (t) =>
    replaceInBlock(t, '.sessionStatusDotRunning', '  color: var(--success-color, #3fb950);\n', ''),
  'M3-running-rule-moved-before-base': (t) => {
    const r = ruleBlock(t, '.sessionStatusDotRunning');
    const rule = r.text;
    const without = t.slice(0, r.start) + t.slice(r.end);
    const base = without.indexOf('\n.sessionStatusDot {');
    if (base < 0) throw new Error('base rule not found after removal');
    return without.slice(0, base + 1) + rule + '\n' + without.slice(base + 1);
  },
  'M4-base-token-to-success': (t) =>
    replaceInBlock(t, '.sessionStatusDot', 'color: var(--agent-blue-500);', 'color: var(--success-color, #3fb950);'),
  'M5-running-token-near-miss': (t) =>
    replaceInBlock(t, '.sessionStatusDotRunning', 'var(--success-color, #3fb950)', 'var(--success-color-alt, #3fb950)'),
  'M6-running-decl-multiline': (t) =>
    replaceInBlock(
      t,
      '.sessionStatusDotRunning',
      'color: var(--success-color, #3fb950);',
      'color: var(\n    --success-color,\n    #3fb950\n  );',
    ),
  'M7-higher-specificity-blue-override': (t) =>
    t + '\n.sessionStatusDot.sessionStatusDotRunning {\n  color: var(--agent-blue-500);\n}\n',
  'M8-media-blue-override': (t) =>
    t + '\n@media (hover: hover) {\n  .sessionStatusDotRunning {\n    color: var(--agent-blue-500);\n  }\n}\n',
  'M9-important-blue-override': (t) =>
    t + '\n.sessionStatusDotRunning {\n  color: var(--agent-blue-500) !important;\n}\n',
};
