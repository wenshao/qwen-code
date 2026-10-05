// Round 9 candidate for the 2a3688d703 stop-route regression, applied to a
// compiled managed-child-run-supervisor.js: when the natural-end settle
// (settleOnEmpty) empties and removes the unit while terminate() is still
// waiting on it, terminate answers that settle's evidence instead of
// throwing ENOENT from cgroup.kill / rmdir.
import fs from 'node:fs';
const file = process.argv[2];
let s = fs.readFileSync(file, 'utf8');
const a = `        await this.unit.terminate(graceMs);
        if (!this.unit.empty())
            return null;
        this.unit.remove();`;
if (s.split(a).length !== 2) throw new Error('anchor');
s = s.replace(a, () => `        try {
            await this.unit.terminate(graceMs);
        }
        catch (error) {
            if (!this.settled)
                throw error;
        }
        if (this.settled)
            return this.evidence;
        if (!this.unit.empty())
            return null;
        this.unit.remove();`);
fs.writeFileSync(file, s);
console.log('patched terminate race');
