export const EDGE_FACTS = () => {
  const paths = [...document.querySelectorAll('[data-plan-edge]')];
  const svg = paths[0]?.ownerSVGElement;
  const canvas = document.querySelector('[data-plan-node-id]')?.closest('[class*="dagCanvas"]');
  const sr = (svg || canvas).getBoundingClientRect();
  const nodes = [...document.querySelectorAll('[data-plan-node-id]')].map((b) => {
    const r = b.closest('article').getBoundingClientRect();
    return { id: b.getAttribute('data-plan-node-id'), l: r.left - sr.left, r: r.right - sr.left, t: r.top - sr.top, b: r.bottom - sr.top };
  });
  const parse = (d) => {
    const tok = d.match(/[MCQHVLZ]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
    let i = 0, cmd = '', cur = [0, 0], prevCtl = null, cmds = '', guard = 0;
    const verts = [];
    const num = () => Number(tok[i++]);
    while (i < tok.length && guard++ < 500) {
      if (/[A-Z]/.test(tok[i])) { cmd = tok[i++]; cmds += cmd; }
      if (cmd === 'M') { cur = [num(), num()]; prevCtl = null; }
      else if (cmd === 'L') { prevCtl = cur; cur = [num(), num()]; }
      else if (cmd === 'C') { num(); num(); const c2 = [num(), num()]; prevCtl = c2; cur = [num(), num()]; }
      else if (cmd === 'Q') { const c1 = [num(), num()]; prevCtl = c1; cur = [num(), num()]; }
      else if (cmd === 'H') { prevCtl = cur; cur = [num(), cur[1]]; }
      else if (cmd === 'V') { const y = num(); verts.push({ x: cur[0], y1: cur[1], y2: y }); prevCtl = cur; cur = [cur[0], y]; }
      else i++;
    }
    return { cmds, end: cur, prevCtl, verts };
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const firstArticle = document.querySelector('[data-plan-node-id]')?.closest('article');
  return {
    viewport: innerWidth,
    gap: canvas && getComputedStyle(canvas).columnGap,
    svgPaintsBeforeNodes: !!(svg && firstArticle && svg.compareDocumentPosition(firstArticle) & Node.DOCUMENT_POSITION_FOLLOWING),
    svgZ: svg && getComputedStyle(svg).zIndex,
    articlePosition: firstArticle && `${getComputedStyle(firstArticle).position} z=${getComputedStyle(firstArticle).zIndex}`,
    svgOrigin: [r1(sr.left), r1(sr.top)],
    edges: paths.map((p) => {
      const { cmds, end, prevCtl, verts } = parse(p.getAttribute('d'));
      const from = p.getAttribute('data-from');
      const to = p.getAttribute('data-to');
      const tan = prevCtl ? [r1(end[0] - prevCtl[0]), r1(end[1] - prevCtl[1])] : null;
      const dir = !tan ? 'n/a' : tan[0] === 0 && tan[1] === 0 ? 'degenerate' : Math.abs(tan[0]) >= Math.abs(tan[1]) ? (tan[0] > 0 ? 'right' : 'LEFT') : tan[1] > 0 ? 'down' : 'up';
      const crossings = [];
      for (const v of verts) {
        const y1 = Math.min(v.y1, v.y2), y2 = Math.max(v.y1, v.y2);
        for (const n of nodes) {
          if (n.id === from || n.id === to) continue;
          if (v.x > n.l && v.x < n.r && y2 > n.t && y1 < n.b) {
            crossings.push({ node: n.id, x: r1(v.x), insideLeftEdgeBy: r1(v.x - n.l), overlapPx: r1(Math.min(y2, n.b) - Math.max(y1, n.t)), atY: r1((Math.max(y1, n.t) + Math.min(y2, n.b)) / 2) });
          }
        }
      }
      return { from, to, kind: cmds.includes('V') ? 'lane' : 'adjacent', cmds, d: p.getAttribute('d'), end: end.map(r1), tangent: tan, arrowhead: dir, verts: verts.map((v) => ({ x: r1(v.x), y1: r1(v.y1), y2: r1(v.y2) })), crossings };
    }),
    nodes: nodes.map((n) => ({ ...n, l: r1(n.l), r: r1(n.r), t: r1(n.t), b: r1(n.b) })),
  };
};
