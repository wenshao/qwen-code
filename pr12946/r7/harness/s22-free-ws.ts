import { leaseHeld, result } from './rig12946-lib.js';
const out: Record<number, number> = {}; for (let w = 0; w < 16; w++) out[w] = await leaseHeld(w); result('free', out);
