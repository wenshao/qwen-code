import fs from 'node:fs';
const H = '/root/verify/pr12421-harness';
const first = (t) => JSON.parse(fs.readFileSync(`${H}/logs/${t}.wire.jsonl`, 'utf8').split('\n')[0]).body;
const pick = (proto, b) => {
  const tools = b.tools || [];
  if (proto === 'chat') { const t = tools.find((x) => x.function?.name === 'read_file'); return { params: t.function.parameters, strict: t.function.strict, all: tools }; }
  if (proto === 'responses') { const t = tools.find((x) => x.name === 'read_file'); return { params: t.parameters, strict: t.strict, all: tools }; }
  const t = tools.find((x) => x.name === 'read_file'); return { params: t.input_schema, strict: t.strict, all: tools };
};
const unionCount = (tools) => (JSON.stringify(tools).match(/"type":\[/g) || []).length;
const anyOfCount = (tools) => (JSON.stringify(tools).match(/"anyOf":/g) || []).length;
for (const proto of ['chat', 'responses', 'anthropic']) {
  for (const arm of ['base', 'pr']) {
    const d = pick(proto, first(`${arm}-${proto}-notebook`));
    const p = d.params.properties;
    console.log(`${proto.padEnd(9)} ${arm.padEnd(4)} tools=${d.all.length} file_path=${JSON.stringify(p.file_path.type)} offset=${JSON.stringify(p.offset.type)} limit=${JSON.stringify(p.limit.type)} pages=${JSON.stringify(p.pages.type)} required=${JSON.stringify(d.params.required)} strict=${JSON.stringify(d.strict)} addlProps=${JSON.stringify(d.params.additionalProperties)} | payload type-arrays=${unionCount(d.all)} anyOf=${anyOfCount(d.all)}`);
  }
}
