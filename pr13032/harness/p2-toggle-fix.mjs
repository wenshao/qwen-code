import fs from 'node:fs';
const f = process.argv[2];
let t = fs.readFileSync(f, 'utf8');
const old = `            if ("T".equals(mode)) {
                harness.setAvailable(true);
                pausedAt = System.nanoTime();`;
const neu = `            if ("T".equals(mode)) {
                harness.setAvailable(true);
                try {
                    // Random phase against the 50 ms scan, as when a paused
                    // test starts after an unpaused one.
                    Thread.sleep(java.util.concurrent.ThreadLocalRandom
                            .current().nextInt(60));
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    return;
                }
                pausedAt = System.nanoTime();`;
if (!t.includes(old)) throw new Error('anchor');
t = t.replace(old, neu);
t = t.replace('        long[] pauseToInsert = new long[PROBE_ITERATIONS];', '        int iterations = "T".equals(mode) ? 2_000 : PROBE_ITERATIONS;\n        long[] pauseToInsert = new long[iterations];');
t = t.replace('        for (int i = 0; i < PROBE_ITERATIONS; i++) {\n            long pausedAt', '        for (int i = 0; i < iterations; i++) {\n            long pausedAt');
t = t.replace(`                + PROBE_ITERATIONS + " lostClaims="`, `                + iterations + " lostClaims="`);
t = t.replace(`                + pauseToInsert[PROBE_ITERATIONS / 2] / 1000 + "/"
                + pauseToInsert[PROBE_ITERATIONS * 99 / 100] / 1000);`, `                + pauseToInsert[iterations / 2] / 1000 + "/"
                + pauseToInsert[iterations * 99 / 100] / 1000);`);
fs.writeFileSync(f, t);
console.log((t.match(/PROBE_ITERATIONS/g)||[]).length, 'refs left');
