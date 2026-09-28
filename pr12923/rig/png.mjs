// Minimal PNG encoder: a "dashboard-like" RGB image whose top band is smooth
// panels and whose lower band is seeded noise, so the file size is controlled
// by the noise height while the picture stays recognisable in screenshots.
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function makePng({ width, height, noiseRows, seed = 1 }) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) & 0xff;
  };
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    const noisy = y >= height - noiseRows;
    for (let x = 0; x < width; x++) {
      const o = 1 + x * 3;
      if (noisy) {
        row[o] = rnd();
        row[o + 1] = rnd();
        row[o + 2] = rnd();
      } else {
        const panel = Math.floor((x / width) * 4);
        const band = Math.floor((y / (height - noiseRows || 1)) * 3);
        const base = [
          [37, 99, 235],
          [22, 163, 74],
          [234, 88, 12],
          [147, 51, 234],
        ][panel];
        const edge = x % Math.floor(width / 4) < 6 || y % Math.floor((height - noiseRows) / 3 || 1) < 6;
        row[o] = edge ? 245 : Math.min(255, base[0] + band * 30);
        row[o + 1] = edge ? 245 : Math.min(255, base[1] + band * 25);
        row[o + 2] = edge ? 245 : Math.min(255, base[2] + band * 20);
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
