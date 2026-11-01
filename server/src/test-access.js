'use strict';
const { timingSafeEqual } = require('node:crypto');

// Optional gate for a short-lived, shared test workspace. Not a multi-user login system.
function testAccess(env = process.env, now = Date.now) {
  if (env.TEST_ACCESS_REQUIRED !== '1') return null;
  const token = env.TEST_ACCESS_TOKEN || '';
  const expires = Date.parse(env.TEST_ACCESS_EXPIRES_AT || '');
  if (token.length < 32 || !Number.isFinite(expires) || expires <= now()) {
    throw new Error('临时测试必须配置有效的访问凭证及未来到期时间');
  }
  const expected = Buffer.from('Bearer ' + token);
  return (req, res) => {
    const provided = Buffer.from(req.headers.authorization || '');
    const valid = now() < expires && provided.length === expected.length && timingSafeEqual(provided, expected);
    if (valid) return true;
    const message = now() >= expires ? '本轮测试已到期，请联系项目管理员' : '测试访问凭证无效，请重新获取测试版本';
    const body = JSON.stringify({ ok: false, error: { message } });
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return false;
  };
}
module.exports = { testAccess };
