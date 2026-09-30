// Builds one Spring server jar per Java mutant (runtime-broker installed into a
// private Maven repository, then the server packaged against it).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mutants } from './mutants-13118.mjs';
const SP = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const WT = path.join(SP, 'wt-jmut');
const env = { ...process.env, JAVA_HOME: '/Users/wenshao/Install/jdk21', PATH: `/Users/wenshao/Install/jdk21/bin:${process.env.PATH}` };
const mvn = (args, log) => {
  const r = spawnSync('/Users/wenshao/Install/maven/bin/mvn', ['--batch-mode', '--no-transfer-progress', '-o', `-Dmaven.repo.local=${SP}/m2-jmut`, ...args], { cwd: WT, env, encoding: 'utf8', maxBuffer: 256 << 20 });
  fs.writeFileSync(log, `${r.stdout}\n${r.stderr}`);
  return r.status;
};
for (const id of process.argv.slice(2)) {
  const m = mutants.find((x) => x.id === id);
  const file = path.join(WT, m.file);
  const source = fs.readFileSync(file, 'utf8');
  if (source.split(m.find).length !== 2) throw new Error(`${id} anchor`);
  fs.writeFileSync(file, source.replace(m.find, m.replace));
  try {
    const a = mvn(['-f', 'packages/sdk-java/runtime-broker/pom.xml', '-DskipTests', 'clean', 'install'], `${SP}/logs/jmut-${id}-broker.log`);
    const b = mvn(['-f', 'packages/sdk-java/managed-agent-server/pom.xml', '-DskipTests', 'clean', 'package'], `${SP}/logs/jmut-${id}-server.log`);
    const jar = path.join(WT, 'packages/sdk-java/managed-agent-server/target/qwen-managed-agent-server-0.1.0-alpha.jar');
    fs.copyFileSync(jar, `${SP}/jars/mut-${id}-server.jar`);
    console.log(`${id} broker=${a} server=${b} jar=${fs.statSync(jar).size}`);
  } finally {
    fs.writeFileSync(file, source);
  }
  if (execFileSync('git', ['status', '--short'], { cwd: WT, encoding: 'utf8' }).trim()) throw new Error('restore failed');
}
