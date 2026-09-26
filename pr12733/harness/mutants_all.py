import importlib.util
def load(n):
    spec = importlib.util.spec_from_file_location(n, '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/c190ac33-9385-406c-a1c1-f75775d345f5/scratchpad/mut/' + n + '.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
one = load('mutants'); two = load('mutants2')
MUTANTS = [('M0', 'no mutation (control)', [])] + [(i, d, [(f, o, n, 1)]) for i, d, f, o, n in one.MUTANTS] + two.MUTANTS
