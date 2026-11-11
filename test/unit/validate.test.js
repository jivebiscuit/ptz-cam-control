const test = require('node:test');
const assert = require('node:assert/strict');
const { int, oneOf, bool, isHost } = require('../../src/validate');

test('int accepts whole numbers and numeric strings in range', () => {
  assert.equal(int(5, 0, 7), 5);
  assert.equal(int('12', 1, 24), 12);
  assert.equal(int(0, 0, 0), 0);
});

test('int rejects NaN, blanks, decimals, text, out-of-range values and non-numbers', () => {
  for (const v of [NaN, '', ' ', null, undefined, 1.5, '1.5', 'abc', 25, -1, '7; DROP', Infinity, {}, []]) {
    assert.throws(() => int(v, 0, 24), /whole number from 0 to 24/, `should reject ${JSON.stringify(v)}`);
  }
});

test('int names the setting in its error message', () => {
  assert.throws(() => int(99, 1, 24, 'pan speed'), /pan speed must be a whole number from 1 to 24/);
});

test('oneOf and bool', () => {
  assert.equal(oneOf('up', ['up', 'down']), 'up');
  assert.throws(() => oneOf('sideways', ['up', 'down'], 'direction'), /direction must be one of: up, down/);
  assert.throws(() => oneOf('__proto__', ['up', 'down']));
  assert.equal(bool(true), true);
  for (const v of [1, 0, 'true', null, undefined]) assert.throws(() => bool(v, 'on'), /on must be true or false/);
});

test('isHost accepts real IPs and host names', () => {
  for (const h of ['192.168.0.200', '10.0.0.1', '0.0.0.0', '255.255.255.255', 'cam1', 'cam-1.local', 'a.b.c', 'cam1.example.com']) {
    assert.ok(isHost(h), `should accept ${h}`);
  }
});

test('isHost rejects impossible IPs, IPv4 shorthand and injection-style text', () => {
  const bad = ['', '300.1.1.1', '1.2.3', '1.2.3.4.5', '1.2.3.', '.1.2.3.4', '01234.1.1.1', '192.168.0.1.', 'cam 1', 'a/b', 'a:80',
    '-bad', 'bad-', '<img>', '192.168.0.1&x=1', 'x'.repeat(300), null, 5, undefined];
  for (const h of bad) assert.ok(!isHost(h), `should reject ${JSON.stringify(h)}`);
});
