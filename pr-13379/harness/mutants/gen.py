import re, pathlib, sys
src = pathlib.Path('/root/verify/pr13379/head/packages/core/src/extension/extensionManager.ts').read_text()
start = src.index('    const batchSize = 4;\n')
end = src.index('    return extensions;\n', start)
orig = src[start:end]
LOAD = "this.loadExtension(\n              { extensionDir: path.join(extensionsDir, subdir), workspaceDir },\n              options,\n            )"
def batch(n): return orig.replace('const batchSize = 4;', f'const batchSize = {n};')
M = {}
M['m01-serial-batch1'] = ('batch size 1 (the old serial loop)', batch(1))
M['m02-batch8'] = ('batch size 8', batch(8))
M['m03-unbounded'] = ('one unbounded batch over all entries', batch('Number.MAX_SAFE_INTEGER'))
M['m04-promise-all-failfast'] = ('Promise.all (fail fast, no drain)', orig.replace('Promise.allSettled(', 'Promise.all(').replace(
"      for (const result of results) {\n        if (result.status === 'rejected') throw result.reason;\n        if (result.value != null) extensions.push(result.value);\n      }",
"      for (const value of results) {\n        if (value != null) extensions.push(value);\n      }"))
M['m05-completion-order'] = ('consume results in completion order', orig.replace(
"      const results = await Promise.allSettled(", "      const done: any[] = [];\n      await Promise.allSettled(").replace(
LOAD, LOAD + ".then((value) => { done.push({ status: 'fulfilled', value }); return value; }, (reason) => { done.push({ status: 'rejected', reason }); throw reason; })").replace(
"for (const result of results)", "for (const result of done)"))
M['m06-first-error-by-time'] = ('throw the first rejection by completion time (values in dir order)', orig.replace(
"      const results = await Promise.allSettled(", "      const failed: unknown[] = [];\n      const results = await Promise.allSettled(").replace(
LOAD, LOAD + ".catch((reason) => { failed.push(reason); throw reason; })").replace(
"      for (const result of results) {", "      if (failed.length > 0) throw failed[0];\n      for (const result of results) {"))
M['m07-defer-error-keep-scanning'] = ('remember first error, keep starting later batches, throw at end', orig.replace(
"const batchSize = 4;", "const batchSize = 4;\n    let firstError: unknown;\n    let hasError = false;").replace(
"if (result.status === 'rejected') throw result.reason;", "if (result.status === 'rejected') { if (!hasError) { hasError = true; firstError = result.reason; } continue; }") + "    if (hasError) throw firstError;\n")
M['m08-no-null-filter'] = ('push null results too', orig.replace("if (result.value != null) extensions.push(result.value);", "extensions.push(result.value as Extension);"))
M['m09-swallow-rejections'] = ('skip rejected entries instead of rethrowing', orig.replace("if (result.status === 'rejected') throw result.reason;", "if (result.status === 'rejected') continue;"))
M['m10-sliding-pool4'] = ('sliding window pool of 4 (no batch barrier), dir-order results + first dir-order error', """    const limit = 4;
    const settled: PromiseSettledResult<Extension | null>[] = new Array(subdirs.length);
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && next < subdirs.length) {
        const i = next++;
        const subdir = subdirs[i];
        try {
          settled[i] = { status: 'fulfilled', value: await """ + LOAD + """ };
        } catch (reason) {
          settled[i] = { status: 'rejected', reason };
          stop = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, subdirs.length) }, worker));
    for (const result of settled) {
      if (!result) continue;
      if (result.status === 'rejected') throw result.reason;
      if (result.value != null) extensions.push(result.value);
    }
""")
out = pathlib.Path('/root/verify/pr13379/harness/mutants')
for k, (desc, body) in M.items():
    assert body != orig, k
    (out / f'{k}.ts').write_text(src[:start] + body + src[end:])
    (out / f'{k}.desc').write_text(desc)
print(len(M), 'mutants')
