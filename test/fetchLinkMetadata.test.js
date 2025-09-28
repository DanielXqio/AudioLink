const assert = require('node:assert');
const dns = require('node:dns');
const { test, mock } = require('node:test');

const { isSafePublicUrl } = require('../src/server');

test('rejects localhost hostnames', async () => {
  assert.strictEqual(await isSafePublicUrl('http://localhost:3000'), false);
});

test('rejects loopback IPv4 addresses', async () => {
  assert.strictEqual(await isSafePublicUrl('http://127.0.0.1:8080'), false);
});

test('rejects private addresses resolved via DNS', async () => {
  const lookupMock = mock.method(dns.promises, 'lookup', async () => [
    { address: '10.0.0.15', family: 4 },
  ]);
  try {
    assert.strictEqual(await isSafePublicUrl('http://example.com'), false);
  } finally {
    lookupMock.mock.restore();
  }
});

test('allows public addresses resolved via DNS', async () => {
  const lookupMock = mock.method(dns.promises, 'lookup', async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  try {
    assert.strictEqual(await isSafePublicUrl('https://example.com'), true);
  } finally {
    lookupMock.mock.restore();
  }
});

test('rejects IPv6 loopback addresses', async () => {
  assert.strictEqual(await isSafePublicUrl('http://[::1]/'), false);
});
