import base from './mutants.mjs';
const by = Object.fromEntries(base.map(m => [m.id, m]));
const combo = (id, ids, what) => ({ id, what, edits: ids.map(i => ({ file: by[i].file, find: by[i].find, rep: by[i].rep })) });
export default [
  combo('C1', ['M13', 'M14'], 'M13+M14: no requireOpen after lookup nor before write'),
  combo('C2', ['M13', 'M14', 'M20'], 'M13+M14+M20: every takeover requireOpen except scan entry'),
  combo('C3', ['M15', 'M17'], 'M15+M17: no identity check and no re-read'),
];
