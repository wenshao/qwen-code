// Writes schemaValidator.probe.js next to the PR's built schemaValidator.js, counting what the new
// catch sees: copy failed; object compiled / failed with the copy's error / failed as duplicate $id.
// usage: node make-catch-probe.cjs <packages/core/dist/src/utils>; then probe-stats.mjs <probe.js> <cases...>
const fs = require('fs'); const D = process.argv[2];
let s = fs.readFileSync(`${D}/schemaValidator.js`, 'utf8');
const a = `            try {
                return validator.compile(schema);
            }
            catch {
                // The object fails as its copy did, or as a duplicate of the $id its
                // copy claimed first. Either way the copy's error is its own.
                throw copyError;
            }`;
const b = `            const st = (globalThis.__catchStats ??= { copyFailed: 0, objectCompiled: 0, objectSameError: 0, objectDuplicate: 0, objectOther: [] });
            st.copyFailed++;
            try {
                const v = validator.compile(schema);
                st.objectCompiled++;
                return v;
            }
            catch (objectError) {
                if (objectError?.message === copyError?.message) st.objectSameError++;
                else if (/already exists/.test(objectError?.message)) st.objectDuplicate++;
                else st.objectOther.push([copyError?.message, objectError?.message]);
                throw copyError;
            }`;
if (s.split(a).length !== 2) throw new Error('anchor');
fs.writeFileSync(`${D}/schemaValidator.probe.js`, s.replace(a, b));
