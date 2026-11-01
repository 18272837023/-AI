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

test('小程序请求、上传、下载均携带同一测试凭证，普通本机模式不添加凭证', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const module = { exports: {} }, seen = [];
  const globalData = { apiBaseUrl: 'https://example.invalid', apiAccessToken: 'private-test-token' };
  const wx = {
    request(o) { seen.push(o); o.success({ statusCode:200, data:{ok:true,data:{}} }); },
    uploadFile(o) { seen.push(o); o.success({data:JSON.stringify({ok:true,data:{}})}); },
    downloadFile(o) { seen.push(o); o.success({statusCode:200,tempFilePath:'draft.docx'}); },
    openDocument(o) { o.success(); },
    getStorageSync() { return 'test-project'; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'), { module, exports:module.exports, wx, getApp:()=>({globalData}) });
  await module.exports.request('/v1/health');
  await module.exports.upload({path:'test.txt'});
  await module.exports.download(true);
  assert.equal(seen.length,3);
  for (const request of seen) assert.equal(request.header.Authorization,'Bearer private-test-token');
  delete globalData.apiAccessToken;
  await module.exports.request('/v1/health');
  assert.equal(seen[3].header.Authorization,undefined);
});

test('测试访问码只在首次拒绝后询问，验证通过才记住，错误输入不会无限重试', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const module = {exports:{}}, globalData = {apiBaseUrl:'https://example.invalid'}, saved = new Map();
  const validCode = 'a'.repeat(64);
  let entered = validCode, prompts = 0, requests = 0, expired = false;
  const wx = {
    getStorageSync:k=>saved.get(k), setStorageSync:(k,v)=>saved.set(k,v), removeStorageSync:k=>saved.delete(k),
    showModal(o) { prompts++; assert.equal(o.editable,true); o.success({confirm:true,content:entered}); },
    request(o) {
      requests++;
      o.success(!expired && o.header.Authorization==='Bearer '+validCode
        ? {statusCode:200,data:{ok:true,data:'accepted'}}
        : {statusCode:401,data:{ok:false,error:{message:expired?'本轮测试已到期，请联系项目管理员':'测试访问凭证无效，请重新获取测试版本'}}});
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module,exports:module.exports,wx,getApp:()=>({globalData})});
  assert.equal(await module.exports.request('/v1/health'),'accepted');
  assert.equal(prompts,1); assert.equal(requests,2); assert.equal(saved.get('temporaryTestAccessToken'),validCode);
  delete globalData.apiAccessToken;
  assert.equal(await module.exports.request('/v1/health'),'accepted'); assert.equal(prompts,1);
  saved.clear(); delete globalData.apiAccessToken; entered='b'.repeat(64);
  await assert.rejects(module.exports.request('/v1/health'),/测试访问凭证无效/);
  assert.equal(prompts,2); assert.equal(requests,5); assert.equal(saved.size,0);
  expired=true;
  await assert.rejects(module.exports.request('/v1/health'),/到期/); assert.equal(prompts,2);
});
