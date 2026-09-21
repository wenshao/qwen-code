import fs from 'node:fs'; import { execSync } from 'node:child_process';
const WT = '/root/verify/pr12421-head';
const F = `${WT}/packages/core/src/tools/read-file.ts`;
const pristine = execSync(`git -C ${WT} show 5f6ff4a6ef:packages/core/src/tools/read-file.ts`).toString();
const nbBlock = `    if (
      path.extname(filePath).toLowerCase() === '.ipynb' &&
      (params.offset !== undefined ||
        params.limit !== undefined ||
        params.pages !== undefined)
    ) {
      return \`For Jupyter notebooks (.ipynb), omit 'offset', 'limit', and 'pages' or set them to null. Retry with: \${JSON.stringify({ file_path: filePath, offset: null, limit: null, pages: null })}\`;
    }
`;
const trimBlock = `    if (params.pages !== undefined) {
      const pages = params.pages.trim();
      params.pages = pages.length > 0 ? pages : undefined;
    }
`;
const limitCheckEnd = `      return 'Limit must be a positive integer';
    }
`;
const M = {
  M01_drop_offset_normalize: (s) => s.replace('    params.offset ??= undefined;\n', ''),
  M02_drop_limit_normalize: (s) => s.replace('    params.limit ??= undefined;\n', ''),
  M03_drop_pages_normalize: (s) => s.replace('    params.pages ??= undefined;\n', ''),
  M04_notebook_check_after_numeric: (s) => s.replace(nbBlock, '').replace(limitCheckEnd, limitCheckEnd + '\n' + nbBlock),
  M05_drop_notebook_check: (s) => s.replace(nbBlock, ''),
  M06_notebook_check_ignores_pages: (s) => s.replace("params.limit !== undefined ||\n        params.pages !== undefined)", 'params.limit !== undefined)'),
  M07_retry_example_offset0: (s) => s.replace('offset: null, limit: null, pages: null })', 'offset: 0, limit: null, pages: null })'),
  M08_retry_example_omits_nulls: (s) => s.replace('JSON.stringify({ file_path: filePath, offset: null, limit: null, pages: null })', 'JSON.stringify({ file_path: filePath })'),
  M09_trim_after_notebook_check: (s) => s.replace(trimBlock, '').replace(nbBlock, nbBlock + '\n' + trimBlock),
  M10_schema_offset_integer_only: (s) => s.replace("type: ['integer', 'null'],", "type: 'integer',"),
  M11_schema_limit_integer_only: (s) => { const i = s.indexOf("type: ['integer', 'null'],"); const j = s.indexOf("type: ['integer', 'null'],", i + 1); return s.slice(0, j) + "type: 'integer'," + s.slice(j + "type: ['integer', 'null'],".length); },
  M12_schema_pages_string_only: (s) => s.replace("type: ['string', 'null'],", "type: 'string',"),
  M13_execute_passes_raw_null: (s) => s.replace('offset: this.params.offset ?? undefined,', 'offset: this.params.offset as number,').replace('limit: this.params.limit ?? undefined,', 'limit: this.params.limit as number,').replace('pages: this.params.pages ?? undefined,', 'pages: this.params.pages as string,'),
  M14_description_raw_params: (s) => s.replace('const offset = this.params.offset ?? undefined;\n    const limit = this.params.limit ?? undefined;', 'const { offset, limit } = this.params as { offset?: number; limit?: number };'),
  M15_toolLocations_raw: (s) => s.replace('line: this.params.offset ?? undefined', 'line: this.params.offset as number'),
  M16_drop_notebook_desc_sentence: (s) => s.replace(" For notebooks, provide 'file_path' and omit 'offset', 'limit', and 'pages' or set them to null.", ''),
};
const results = [];
try {
  for (const [name, fn] of Object.entries(M)) {
    const mutated = fn(pristine);
    if (mutated === pristine) { results.push({ name, status: 'NOT APPLIED' }); console.log(name, 'NOT APPLIED'); continue; }
    fs.writeFileSync(F, mutated);
    const out = `/root/verify/pr12421-harness/out/mut-${name}.json`;
    try { execSync(`cd ${WT}/packages/core && npx vitest run src/tools/read-file.test.ts --reporter=json --outputFile=${out}`, { stdio: 'ignore', timeout: 300000 }); } catch {}
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    const failed = r.testResults.flatMap((f) => f.assertionResults.filter((t) => t.status !== 'passed').map((t) => t.title));
    const collectFail = r.testResults.some((f) => f.status === 'failed' && f.assertionResults.length === 0);
    results.push({ name, failed: failed.length, total: r.numTotalTests, sample: failed.slice(0, 3), collectFail });
    console.log(`${name.padEnd(36)} ${failed.length ? 'KILLED' : 'SURVIVED'} failed=${failed.length}/${r.numTotalTests}${collectFail ? ' (collect fail)' : ''}  ${failed.slice(0, 2).join(' | ').slice(0, 150)}`);
  }
} finally {
  fs.writeFileSync(F, pristine);
  console.log('restored; git status:', JSON.stringify(execSync(`git -C ${WT} status --porcelain`).toString()));
}
fs.writeFileSync('/root/verify/pr12421-harness/out/mutants.json', JSON.stringify(results, null, 1));
