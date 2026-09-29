// PR #12868 round 7, head 760174073b: mutants of the lines commit 760174073b adds.
const PROTOCOL = 'packages/cli/src/serve/managed-runtime-provider-protocol.ts';
const DROP = `    if (toolResult && toolResult['artifacts'] !== undefined && overflows())
      delete toolResult['artifacts'];
`;
export const superseded7e = new Set();
export const reanchored7e = {};
export const round7e = [
  { id: 'R1', suite: 'ts', file: PROTOCOL, what: 'artifacts that cannot fit are not dropped', find: DROP, replace: '' },
  { id: 'R2', suite: 'ts', file: PROTOCOL, what: 'artifacts are dropped from every result that is fitted, whether they fit or not',
    find: "    if (toolResult && toolResult['artifacts'] !== undefined && overflows())\n", replace: "    if (toolResult && toolResult['artifacts'] !== undefined)\n" },
];
