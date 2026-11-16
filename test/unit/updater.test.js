const test = require('node:test');
const assert = require('node:assert');
const { parseVersion, isNewer } = require('../../src/updater');

test('parseVersion reads plain and v-prefixed versions', () => {
  assert.deepStrictEqual(parseVersion('v0.3.1'), [0, 3, 1]);
  assert.deepStrictEqual(parseVersion('1.10.0-beta'), [1, 10, 0]);
  assert.strictEqual(parseVersion('latest'), null);
  assert.strictEqual(parseVersion(undefined), null);
});

test('isNewer compares numerically, not as text', () => {
  assert.ok(isNewer('v0.3.0', '0.2.0'));
  assert.ok(isNewer('0.10.0', '0.9.0'));
  assert.ok(!isNewer('0.2.0', '0.2.0'));
  assert.ok(!isNewer('0.1.9', '0.2.0'));
  assert.ok(!isNewer('garbage', '0.2.0'));
});
