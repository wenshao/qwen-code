// Emulates, in memory, an Ajv that does not keep a schema object whose compile threw.
// AJV_NOKEEP=all: drop the object on any throw. AJV_NOKEEP=dup: drop it only when the throw is
// the duplicate-$id check (as if Ajv cached the object after _checkUnique instead of before).
import AjvPkg from 'ajv';
const AjvClass = (AjvPkg as any).default || AjvPkg;
let core = AjvClass.prototype;
while (!Object.prototype.hasOwnProperty.call(core, 'compile')) core = Object.getPrototypeOf(core);
const compile = core.compile;
const mode = process.env['AJV_NOKEEP'];
(globalThis as any).__nokeepDrops = 0;
core.compile = function (this: any, schema: unknown, meta?: boolean) {
  try {
    return compile.call(this, schema, meta);
  } catch (error) {
    const dup = error instanceof Error && /already exists/.test(error.message);
    if (typeof schema === 'object' && schema !== null && (mode === 'all' || (mode === 'dup' && dup))) {
      if (this._cache.delete(schema)) (globalThis as any).__nokeepDrops++;
    }
    throw error;
  }
};
