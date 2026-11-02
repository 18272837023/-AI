'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function setup(){
 let data=new Map(),lock=null,fail=false;
 const pool={query:async()=>[],end:async()=>{},getConnection:async()=>{
  const c={staged:null,query:async(sql,args)=>{
   if(sql.includes('GET_LOCK')){if(lock&&lock!==c)return [[{acquired:0}]];lock=c;return [[{acquired:1}]];}
   if(sql.includes('RELEASE_LOCK')){if(lock===c)lock=null;return [[]];}
   if(sql.startsWith('SELECT kind'))return [[...data.values()].map(row=>({...row}))];
   throw Error('unexpected query');
  },beginTransaction:async()=>{c.staged=new Map(data);},execute:async(sql,[kind,id,body])=>{if(fail)throw Error('simulated database outage');c.staged.set(kind+'/'+id,{kind,id,body});},commit:async()=>{data=c.staged;},rollback:async()=>{},release:()=>{}};
  return c;
 }};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/lib/cloud-state.js'),'utf8'),{module,process:{env:{STORE_DRIVER:'mysql',MYSQL_ADDRESS:'localhost:3306',MYSQL_DATABASE:'test',MYSQL_USERNAME:'test',MYSQL_PASSWORD:'not-real'}},require:name=>name==='mysql2/promise'?{createPool:()=>pool}:name==='./mysql-config'?require('../src/lib/mysql-config'):require(name),Map,JSON});
 return {cloud:module.exports,fail:()=>{fail=true;}};
}

test('MySQL 适配器协议测试：持久化后新请求恢复状态，未提交变化不泄漏到轮询',async()=>{
 const {cloud}=setup();await cloud.init();
 await cloud.run(true,()=>{cloud.state({}).tenders.T={id:'T',name:'saved'};cloud.save();});
 assert.equal(await cloud.run(false,()=>cloud.state({}).tenders.T.name),'saved');
 let release,started;
 const ready=new Promise(r=>started=r),barrier=new Promise(r=>release=r);
 const writer=cloud.run(true,async()=>{cloud.state({}).tenders.T.name='new';started();await barrier;});
 await ready;
 assert.equal(await cloud.run(false,()=>cloud.state({}).tenders.T.name),'saved');
 await assert.rejects(cloud.run(true,()=>{}),e=>e.statusCode===409);
 release();await writer;
 assert.equal(await cloud.run(false,()=>cloud.state({}).tenders.T.name),'new');
});

test('提交失败不能回复成功；写入锁释放，未成功提交的数据不会代替旧结果',async()=>{
 const {cloud,fail}=setup();
 await cloud.run(true,()=>{cloud.state({}).tenders.T={name:'original'};});fail();
 await assert.rejects(cloud.run(true,()=>{cloud.state({}).tenders.T.name='lost';cloud.save();}),/outage/);
 assert.equal(await cloud.run(false,()=>cloud.state({}).tenders.T.name),'original');
});

test('云路由验证微信身份，并且数据库提交前不发送成功响应',async()=>{
 const {cloud}=setup(),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/cloud-request.js'),'utf8'),{module,process:{env:{WECHAT_APPID:'formal'}},require:()=>cloud,Error});
 const {handle}=module.exports;
 await assert.rejects(handle({path:'/v1/tenders'},{req:{headers:{},method:'POST'}},()=>{}),e=>e.statusCode===401);
 let ended=false;
 await handle({path:'/v1/tenders'},{req:{headers:{'x-wx-appid':'formal','x-wx-openid':'owner-a'},method:'POST'},res:{writeHead(){},end(){ended=true;}}},async({res})=>{
  assert.equal(cloud.owner(),'formal:owner-a');cloud.state({}).tenders.T={owner:cloud.owner()};cloud.save();res.writeHead(200,{});res.end('ok');assert.equal(ended,false);
 });
 assert.equal(ended,true);
});

test('真实 API 路由按微信账号隔离项目列表、项目详情和任务查询',async()=>{
 const {cloud}=setup();
 const load=(file,special)=>{
  const module={exports:{}},abs=path.join(__dirname,'../src',file);
  vm.runInNewContext(fs.readFileSync(abs,'utf8'),{module,require:name=>special[name]||require(require.resolve(name,{paths:[path.dirname(abs)]})),process:{env:{WECHAT_APPID:'formal'}},Buffer,URL,console,setTimeout,clearTimeout,Proxy,Map,JSON});return module.exports;
 };
 const store=load('lib/store.js',{'./cloud-state':cloud});
 const request=load('cloud-request.js',{'./lib/cloud-state':cloud});
 const api=load('api.js',{'./lib/store':store,'./lib/cloud-state':cloud,'./cloud-request':request});
 const invoke=async(method,routePath,owner,params={},data)=>{
  const req=require('node:stream').Readable.from(data?[Buffer.from(JSON.stringify(data))]:[]);req.method=method;req.headers={'x-wx-appid':'formal','x-wx-openid':owner};
  let body;await api.routes.find(r=>r.method===method&&r.path===routePath).handler({req,params,query:new URLSearchParams(),res:{writeHead(){},end:b=>body=JSON.parse(b)}});return body.data;
 };
 const a=await invoke('POST','/v1/tenders','A',{}, {name:'A的项目'});
 assert.equal((await invoke('GET','/v1/tenders','A')).length,1);
 assert.equal((await invoke('GET','/v1/tenders','B')).length,0);
 await assert.rejects(invoke('GET','/v1/tenders/:id','B',{id:a.id}),e=>e.statusCode===404);
 await cloud.run(true,()=>{cloud.state({}).jobs.J={id:'J',tenderId:a.id,status:'done'};});
 await assert.rejects(invoke('GET','/v1/jobs/:jobId','B',{jobId:'J'}),e=>e.statusCode===404);
 assert.equal((await invoke('GET','/v1/jobs/:jobId','A',{jobId:'J'})).id,'J');
});
