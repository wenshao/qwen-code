# Same edits as round 1; files resolved by anchor content (chunk hashes changed after rebase).
import glob, os, importlib.util
WT = os.path.expanduser('~/git/qwen-code-pr12733')
def load(n):
    spec = importlib.util.spec_from_file_location(n, '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c190ac33-9385-406c-a1c1-f75775d345f5/scratchpad/mut/' + n + '.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
_cache = {}
def resolve(old):
    hits = []
    for f in glob.glob(os.path.join(WT, 'dist/chunks/*.js')):
        if f not in _cache: _cache[f] = open(f, encoding='utf-8').read()
        if old in _cache[f]: hits.append(os.path.relpath(f, WT))
    return hits[0] if len(hits) == 1 else f'AMBIGUOUS:{hits}'
one = load('mutants'); two = load('mutants2')
MUTANTS = [('M0', 'no mutation (control)', [])]
for i, d, f, o, n in one.MUTANTS:
    MUTANTS.append((i, d, [(resolve(o), o, n, 1)]))
for i, d, edits in two.MUTANTS:
    MUTANTS.append((i, d, [(resolve(o), o, n, c) for f, o, n, c in edits]))
# Round-2 anchors for code that changed when #12713 landed (N4 filter, SSE stop on close).
H_NEW = 'setHistory(history.filter((entry,index)=>entry.role==="user"?answered(history[index+1]):answered(entry)))'
H_OLD = 'setHistory(history.filter((entry,index)=>entry.role!=="user"||history[index+1]?.role==="model"))'
C_NEW = 'try{await session.managed.close();for(const stop of session.streams)stop();sessions.delete(req.params["id"]);'
over = {
 'M2': [(resolve(H_NEW), H_NEW, 'setHistory(history)', 1)],
 'M3': [(resolve(H_NEW), H_NEW, 'setHistory([])', 1)],
 'M13': [(resolve(C_NEW), C_NEW, 'try{for(const stop of session.streams)stop();sessions.delete(req.params["id"]);', 1)],
}
MUTANTS = [(i, d, over.get(i, e)) for i, d, e in MUTANTS]
idx = [i for i, _, _ in MUTANTS].index('M3') + 1
MUTANTS.insert(idx, ('M2b', 'N4 fix reverted: pre-32f3c60 answered filter', [(resolve(H_NEW), H_NEW, H_OLD, 1)]))
