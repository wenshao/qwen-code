export const meta = { name: 'schema-probe', description: 'three agent() calls with one $id schema' }
const S = { $id: 'urn:wf:answer', type: 'object', properties: { answer: { type: 'integer', minimum: 1 } }, required: ['answer'] }
const a = await agent('call 1: submit the answer', { schema: S })
const b = await agent('call 2: submit the answer', { schema: S })
const c = await agent('call 3: submit the answer', { schema: S })
return { a, b, c }
