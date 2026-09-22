import { describe, expect, it } from 'vitest';
import { mapRestoredInputAnnotationsAfterTextChange } from '../useComposerCore.js';
const valid = { type: 'reference', start: 14, end: 24, text: '@README.md', reference: { id: 'file:@README.md', kind: 'file', value: 'README.md' } };
const before = 'NULLMIX check @README.md', after = 'NULLMIX edited check @README.md';
describe('probe: edit remap on live echo meta', () => {
  it('valid only -> remapped by +7', () => {
    expect(mapRestoredInputAnnotationsAfterTextChange([valid] as never, before, after)).toMatchObject([{ start: 21, end: 31 }]);
  });
  it('with a null element (what the live echo delivers) -> TypeError', () => {
    expect(() => mapRestoredInputAnnotationsAfterTextChange([null, valid] as never, before, after)).toThrow(/Cannot read properties of null/);
  });
});
