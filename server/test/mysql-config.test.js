'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mysqlOptions}=require('../src/lib/mysql-config');
const env={MYSQL_ADDRESS:'10.40.107.83:3306',MYSQL_USERNAME:'root',MYSQL_PASSWORD:'a-test-only-password',MYSQL_DATABASE:'ai_tender'};
test('缺失数据库变量逐项点名；诊断信息不包含密码或其他变量值',()=>{
 for(const key of Object.keys(env)){
  const incomplete={...env};delete incomplete[key];
  assert.throws(()=>mysqlOptions(incomplete),e=>e.message.includes(key)&&!e.message.includes(env.MYSQL_PASSWORD));
 }
 assert.throws(()=>mysqlOptions({'`MYSQL_DATABASE`':'ai_tender'}),/MYSQL_ADDRESS、MYSQL_USERNAME、MYSQL_PASSWORD、MYSQL_DATABASE/);
});
test('兼容主机:端口、主机默认端口及非密码字段空白，不篡改密码',()=>{
 const value=mysqlOptions({...env,MYSQL_ADDRESS:' 10.40.107.83 : 3306 ',MYSQL_USERNAME:' root ',MYSQL_DATABASE:' ai_tender ',MYSQL_PASSWORD:' pass with spaces '});
 assert.equal(value.host,'10.40.107.83');assert.equal(value.port,3306);assert.equal(value.user,'root');assert.equal(value.database,'ai_tender');assert.equal(value.password,' pass with spaces ');
 assert.equal(mysqlOptions({...env,MYSQL_ADDRESS:'mysql.internal'}).port,3306);
 assert.equal(mysqlOptions({...env,MYSQL_ADDRESS:'mysql.internal',MYSQL_PORT:'3307'}).port,3307);
});
test('错误地址和端口在连接前明确拒绝',()=>{
 for(const address of ['http://mysql:3306','`mysql:3306`','mysql:0','mysql:65536','mysql:abc'])assert.throws(()=>mysqlOptions({...env,MYSQL_ADDRESS:address}),/MYSQL_ADDRESS 格式无效/);
});
