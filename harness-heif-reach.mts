/**
 * Reachability probe: does the qwen-code image path hand attacker-supplied
 * bytes to libheif *before* the PNG/JPEG/WebP allowlist rejects them?
 */
import sharpMod from 'sharp';
import { renderImageOverview, ImageViewError } from './packages/core/src/utils/image-view.js';
import { writeFileSync } from 'node:fs';

const sharp = sharpMod as unknown as typeof import('sharp');

// 1. Build a HEIF-container image (AVIF) with the very sharp under test.
const png = await sharp({
  create: { width: 64, height: 64, channels: 3, background: '#3366cc' },
}).png().toBuffer();
const heif = await sharp(png).heif({ compression: 'av1', quality: 50 }).toBuffer();
writeFileSync('/tmp/probe.heic', heif);
console.log('generated HEIF container bytes :', heif.length);
console.log('ftyp brand                     :', heif.subarray(8, 16).toString('latin1'));

// 2. What does sharp report for it? (this is libheif parsing the container)
const meta = await sharp(heif).metadata();
console.log('sharp metadata().format        :', meta.format, `${meta.width}x${meta.height}`);
console.log('   -> libheif parsed the file, so the decoder ran on these bytes');

// 3. Now drive the real repo entry point on the same file.
try {
  await renderImageOverview('/tmp/probe.heic', new AbortController().signal);
  console.log('renderImageOverview            : returned a view (unexpected)');
} catch (e) {
  const code = e instanceof ImageViewError ? e.code : '(not ImageViewError)';
  console.log('renderImageOverview error code :', code);
  console.log(
    code === 'unsupported_image'
      ? '   -> rejected only AFTER metadata(); libheif already ran => CVE path reachable'
      : '   -> rejected before libheif ran',
  );
}
