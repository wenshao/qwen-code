// Builds an env object from a JSON spec, so the host spawn and the evaluation see the same shape:
//   base   plain string variables
//   own    own enumerable values; {"$array": [...]}, {"$symbol": "d"}, null are decoded
//   proto  inherited enumerable variables
//   hidden own non-enumerable variables
//   throwing  names of enumerable getters that throw
//   falsy  "undefined" | "null" | "" … : the whole env is that value
const decode = (v) => {
  if (v && typeof v === 'object' && '$array' in v) return v.$array;
  if (v && typeof v === 'object' && '$symbol' in v) return Symbol(v.$symbol);
  if (v && typeof v === 'object' && '$undefined' in v) return undefined;
  return v;
};
export function build(spec) {
  if ('falsy' in spec) return { undefined, null: null, '': '', 0: 0, false: false }[spec.falsy];
  const env = spec.proto ? Object.create(Object.fromEntries(Object.entries(spec.proto).map(([k, v]) => [k, decode(v)]))) : {};
  for (const [k, v] of Object.entries({ ...spec.base, ...spec.own })) {
    Object.defineProperty(env, k, { value: decode(v), enumerable: true, writable: true, configurable: true });
  }
  for (const [k, v] of Object.entries(spec.hidden ?? {})) Object.defineProperty(env, k, { value: decode(v), enumerable: false });
  for (const k of spec.throwing ?? []) Object.defineProperty(env, k, { enumerable: true, get() { throw new Error(`${k} cannot be read`); } });
  return env;
}
