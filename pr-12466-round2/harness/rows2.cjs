const { launch, openSession } = require('./lib.cjs');
(async () => {
  const [base, sidOverview, sidAgent] = process.argv.slice(2);
  const { browser, page, errors } = await launch({});
  const panel = page.getByRole('region', { name: 'Tool calls' });
  const out = {};
  const openPrompt = async (sid, label) => {
    await openSession(page, base, sid);
    await page.getByRole('button', { name: 'View tool calls' }).first().click({ force: true });
    await panel.waitFor({ state: 'visible' });
    await panel.getByRole('combobox', { name: 'Prompt' }).click(); await page.waitForTimeout(400);
    await page.getByRole('option', { name: label }).first().click(); await page.waitForTimeout(2500);
  };
  await openPrompt(sidOverview, 'SCN:overview');
  const lis = panel.locator('[data-web-shell-turn-calls] > li');
  out.rows = (await lis.allInnerTexts()).map(t => t.replace(/\s+/g, ' ').slice(0, 90));
  const mcp = lis.filter({ hasText: 'MCP' }).filter({ hasNotText: 'ToolSearch' }).first();
  await mcp.locator('button[aria-expanded]').first().click(); await page.waitForTimeout(600);
  out.mcpExpanded = (await mcp.innerText()).replace(/\s+/g, ' ').slice(0, 400);
  await mcp.screenshot({ path: 'shots-r2/r2-mcp-wrapped.png' });
  await openPrompt(sidAgent, 'SCN:agentfail');
  await page.screenshot({ path: 'shots-r2/r2-agent-failed-full.png' });
  out.chatAgentCard = (await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/.{0,200}Inspect a failing area.{0,300}/)?.[0];
  console.log(JSON.stringify({ ...out, errors }, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
