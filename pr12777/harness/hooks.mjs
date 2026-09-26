const STUB = new URL('./logstub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === './debugLogger.js' && /\/utils\/schemaValidator(\.probe)?\.js$/.test(context.parentURL ?? '')) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}
