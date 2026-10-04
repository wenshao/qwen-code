// Startup validation of the retry budgets (Spring only).
export default async function (ctx) {
  const D = '--qwen.managed-agent.dispatch.';
  const cases = [
    ['defaults', []],
    ['pre=6 > post default 10', [`${D}max-pre-admission-retries=6`]],
    ['pre=6 > post=5', [`${D}max-pre-admission-retries=6`, `${D}max-post-admission-retries=5`]],
    ['pre=5 = post=5', [`${D}max-pre-admission-retries=5`, `${D}max-post-admission-retries=5`]],
    ['post=-1', [`${D}max-post-admission-retries=-1`]],
    ['op=-1', [`${D}max-operation-retries=-1`]],
    ['op=0', [`${D}max-operation-retries=0`]],
  ];
  ctx.result.boot = [];
  for (const [label, args] of cases) {
    ctx.sql(`DROP DATABASE IF EXISTS ${ctx.db}`);
    ctx.sql(`CREATE DATABASE ${ctx.db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const r = await ctx.bootSpringOnly(args);
    ctx.result.boot.push({ label, ...r });
    ctx.mark('boot', { label, ...r });
  }
}
