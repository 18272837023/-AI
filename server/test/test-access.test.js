'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { testAccess } = require('../src/test-access');
const { createRouter } = require('../src/lib/http');

test('临时入口拒绝空配置、错误凭证与过期访问，普通服务保持原配置', async () => {
  assert.equal(testAccess({}), null);
  assert.throws(() => testAccess({ TEST_ACCESS_REQUIRED: '1' }), /访问凭证/);
  let clock = 10000;
  const gate = testAccess({ TEST_ACCESS_REQUIRED: '1', TEST_ACCESS_TOKEN: 't'.repeat(48), TEST_ACCESS_EXPIRES_AT: new Date(20000).toISOString() }, () => clock);
  let calls = 0;
  const server = createRouter([{method:'GET',path:'/v1/health',handler:({res})=>{calls++;res.end('OK');}}], {beforeRequest:gate});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base+'/v1/health')).status,401);
    assert.equal((await fetch(base+'/unknown')).status,401);
    assert.equal((await fetch(base+'/v1/health',{method:'OPTIONS'})).status,401);
    assert.equal((await fetch(base+'/v1/health',{headers:{Authorization:'Bearer wrong'}})).status,401);
    const headers = { Authorization: 'Bearer ' + 't'.repeat(48) };
    assert.equal((await fetch(base+'/v1/health',{headers})).status,200);
    clock = 20000;
    const expired = await fetch(base+'/v1/health',{headers});
    assert.equal(expired.status,401);
    assert.match((await expired.json()).error.message,/到期/);
    assert.equal(calls,1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
