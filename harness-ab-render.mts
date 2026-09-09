/**
 * A/B: drive the real repo image pipeline with whichever sharp this worktree
 * has installed, and dump deterministic artefacts for cross-tree comparison.
 * MUTATE=1 flips one source pixel: a negative control proving the recorded
 * hashes actually track the rendered pixels.
 */
import sharpMod from 'sharp';
import {
  renderImageOverview,
  renderNormalizedImageCrop,
} from './packages/core/src/utils/image-view.js';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sharp = sharpMod as unknown as typeof import('sharp');
const outDir = process.env.AB_OUT!;
const label = process.env.AB_LABEL!;
const mutate = process.env.MUTATE === '1';
mkdirSync(outDir, { recursive: true });
const signal = new AbortController().signal;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 32);

const W = 1200, H = 800;
const raw = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    raw[i] = (x * 255 / W) | 0;
    raw[i + 1] = (y * 255 / H) | 0;
    raw[i + 2] = ((x ^ y) & 0xff);
  }
}
if (mutate) {
  // A 24x24 magenta patch: a change big enough to survive a lossy re-encode,
  // so an unchanged hash below really means "the renderer produced the same
  // pixels", not "the encoder quantised my perturbation away".
  for (let y = 388; y < 412; y++)
    for (let x = 588; x < 612; x++) {
      const i = (y * W + x) * 3;
      raw[i] = 255; raw[i + 1] = 0; raw[i + 2] = 255;
    }
}

const base = sharp(raw, { raw: { width: W, height: H, channels: 3 } });
const png = await base.clone().png({ compressionLevel: 6 }).toBuffer();
const jpeg = await base.clone().jpeg({ quality: 92 }).withMetadata({ orientation: 6 }).toBuffer();
const webp = await base.clone().webp({ quality: 90 }).toBuffer();

const cases: Array<[string, Buffer]> = [['png', png], ['jpeg-exif6', jpeg], ['webp', webp]];
const report: Record<string, unknown> = {
  label, sharp: sharp.versions.sharp, vips: sharp.versions.vips, heif: sharp.versions.heif,
};

for (const [name, buf] of cases) {
  const src = path.join(outDir, `src-${name}`);
  writeFileSync(src, buf);
  const ov = await renderImageOverview(src, signal);
  // NormalizedRegion is on a 0..1000 scale: this is the centre half.
  const cr = await renderNormalizedImageCrop(src, { x1: 250, y1: 250, x2: 750, y2: 750 }, signal);
  writeFileSync(path.join(outDir, `overview-${name}.jpg`), ov.bytes);
  writeFileSync(path.join(outDir, `crop-${name}.jpg`), cr.bytes);
  const shape = (v: typeof ov) => `${v.sourceWidth}x${v.sourceHeight} sel ${v.selectedWidth}x${v.selectedHeight} -> ${v.outputWidth}x${v.outputHeight}`;
  report[name] = {
    srcSha: sha(buf),
    overview: { shape: shape(ov), bytes: ov.bytes.length, sha: sha(ov.bytes) },
    crop: { shape: shape(cr), bytes: cr.bytes.length, sha: sha(cr.bytes) },
  };
}
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
