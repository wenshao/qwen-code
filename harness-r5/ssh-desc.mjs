import { parseSshWorkspaceUrl, formatSshWorkspaceUrl } from '/root/verify/pr12267-r6/packages/core/dist/src/services/ssh-workspace.js';
import { createHash } from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
const [home, url] = process.argv.slice(2);
const c = parseSshWorkspaceUrl(url); const id = createHash('sha256').update(formatSshWorkspaceUrl(c)).digest('hex');
const dir = path.join(fs.realpathSync(home), 'ssh-workspaces', id); fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({ url })); console.log(path.join(dir, 'workspace'));
