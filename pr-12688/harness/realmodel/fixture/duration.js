'use strict';
// Parse a compact duration string such as "1h30m", "45s" or "2d4h" into
// milliseconds.
const UNITS = { d: 86400000, h: 3600000, m: 60000, s: 1000 };

function parseDuration(input) {
  const re = /(\d+)([dhms])/g;
  let total = 0;
  let match;
  while ((match = re.exec(input))) {
    total += Number(match[1]) * UNITS[match[2]];
  }
  return total;
}

function formatDuration(ms) {
  const parts = [];
  for (const [unit, size] of Object.entries(UNITS)) {
    const n = Math.floor(ms / size);
    if (n > 0) parts.push(`${n}${unit}`);
    ms -= n * size;
  }
  return parts.join('');
}

module.exports = { parseDuration, formatDuration };
