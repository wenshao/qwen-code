// Runs one evaluation in this process (cwd = where the daemon would run). The session hosts' environment is
// rebuilt from a spec with the same shapes the host matrix spawns the real CLI with.
// usage: node eval-case.mjs <managed-compatibility.js> <ws> <spec.json path>
import { build } from './env-spec.mjs';
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [mod, ws, specPath] = process.argv.slice(2);
const { evaluateManagedCompatibility } = await import(pathToFileURL(mod).href);
const environment = build(JSON.parse(readFileSync(specPath, "utf8")));
const r = await evaluateManagedCompatibility({ workspaceCwd: ws },
  { workspaceCwd: ws, workspaceTrusted: true, environment, forwardedArgs: [], hasLiveMcpServers: () => false });
process.stdout.write(JSON.stringify(r));
