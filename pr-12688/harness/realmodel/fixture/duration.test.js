'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration } = require('./duration.js');

test('parses a single unit', () => assert.equal(parseDuration('45s'), 45000));
test('parses compound units', () => assert.equal(parseDuration('1h30m'), 5400000));
test('parses days', () => assert.equal(parseDuration('2d4h'), 187200000));
test('rejects empty input', () => assert.throws(() => parseDuration(''), RangeError));
test('rejects garbage between units', () => assert.throws(() => parseDuration('1hxx30m'), RangeError));
test('rejects a repeated unit', () => assert.throws(() => parseDuration('1h2h'), RangeError));
test('rejects units out of order', () => assert.throws(() => parseDuration('30m1h'), RangeError));
test('formats zero as 0s', () => assert.equal(formatDuration(0), '0s'));
test('round-trips compound values', () => assert.equal(formatDuration(parseDuration('2d4h5m6s')), '2d4h5m6s'));
