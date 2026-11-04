'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/cloud-transport.js'),'utf8');
function load(wx){const module={exports:{}};vm.runInNewContext(source,{module,wx,getApp:()=>({globalData:{cloudHosting:{enabled:true,env:'env',service:'service'}}}),Promise,Error,Date,setTimeout:(fn)=>setTimeout(fn,0)});return module.exports;}
test('小程序云请求发送到指定环境和服务，不使用公网URL',async()=>{
 let sent;
 const client=load({cloud:{callContainer:o=>{sent=o;o.success({statusCode:200,data:{ok:true}});}}});
 assert.equal(client.enabled(),true);await client.call('/v1/tenders','POST',{name:'project'});
 assert.equal(sent.config.env,'env');assert.equal(sent.header['X-WX-SERVICE'],'service');assert.equal(sent.path,'/v1/tenders');assert.equal(sent.url,undefined);
});
test('云调用失败保留微信错误码、失败阶段及原始消息，不暴露上传内容',async()=>{
 const client=load({cloud:{callContainer:o=>o.fail({errCode:102002,errMsg:'request timeout',requestId:'trace-id'})}});
 await assert.rejects(client.call('/v1/tenders/T/uploads/U/parts','POST',{base64:'private-file-data'}),e=>e.message.includes('上传文件分片')&&e.message.includes('102002')&&e.message.includes('request timeout')&&!e.message.includes('private-file-data')&&e.cloudDetail.callID==='trace-id');
});
test('云调用兼容 Promise 拒绝和同步异常，不吞成笼统的服务未连接',async()=>{
 const rejected=load({cloud:{callContainer:()=>Promise.reject({errCode:-1,errMsg:'environment permission denied'})}});
 await assert.rejects(rejected.call('/v1/tenders','POST',{}),/创建项目失败.*-1.*environment permission denied/);
 const thrown=load({cloud:{callContainer:()=>{throw Error('SDK init failed');}}});
 await assert.rejects(thrown.call('/v1/health','GET'),/SDK init failed/);
});
test('我的页面显示实际云托管连接，不误报本机备用地址和共享账号',async()=>{
 let page;
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/mine/mine.js'),'utf8'),{module,Page:p=>page=p,wx:{cloud:{callContainer(){}}},getApp:()=>({globalData:{apiBaseUrl:'http://127.0.0.1:5310',cloudHosting:{enabled:true,service:'express-im06'}}}),require:()=>({action:async(p,fn)=>fn(),request:async()=>[]})});
 page.data={...page.data};page.setData=p=>Object.assign(page.data,p);page.onShow();
 assert.equal(page.data.api,'微信云托管 · express-im06');assert.match(page.data.description,/按微信账号/);assert.equal(page.data.isTemporaryTest,false);
});
test('小程序分片上传保持每个字节与文件名顺序，失败不会提交未完成文件',async()=>{
 const bytes=Buffer.from('abcdefghij'),parts=[];
 const client=load({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:bytes.length}}),readFile:o=>o.success({data:bytes.subarray(o.position,o.position+o.length)})}),arrayBufferToBase64:b=>Buffer.from(b).toString('base64')});
 let complete=false;
 const request=async(p,m,data)=>{if(p.endsWith('/uploads'))return {uploadId:'u',chunkSize:4};if(p.endsWith('/parts')){parts.push(data);return {};}complete=true;return {file:{}};};
 await client.upload({name:'清单.xlsx',path:'file'},'/v1/tenders/T',request);
 assert.equal(complete,true);assert.deepEqual(Buffer.concat(parts.map(p=>Buffer.from(p.base64,'base64'))),bytes);
 complete=false;
 await assert.rejects(client.upload({name:'f',path:'file'},'/v1/tenders/T',async(p)=>{if(p.endsWith('/uploads'))return {uploadId:'u',chunkSize:4};if(p.endsWith('/parts'))throw Error('网络中断');complete=true;}),/网络中断/);
 assert.equal(complete,false);
});
test('分片导出按顺序写入真实文件并校验长度，保留路径供预览及保存，不依赖公网域名',async()=>{
 const bytes=Buffer.from('PK-example-file'),written=[];let opened;
 const local={writeFileSync(){},appendFileSync:(p,b)=>written.push(Buffer.from(b)),unlinkSync(){}};
 const client=load({env:{USER_DATA_PATH:'private'},getFileSystemManager:()=>local,base64ToArrayBuffer:s=>Buffer.from(s,'base64'),openDocument:o=>{opened=o;o.success();}});
 const result=await client.download('/v1/tenders/T','draft=1',async p=>p.includes('export?')?{downloadId:'d',size:bytes.length,parts:2,ext:'docx'}:{base64:(p.endsWith('0')?bytes.subarray(0,4):bytes.subarray(4)).toString('base64')});
 assert.deepEqual(Buffer.concat(written),bytes);assert.equal(result.ext,'docx');assert.match(result.filePath,/\.docx$/);assert.equal(opened,undefined);
});

test('上传分片按实际已确认字节报告进度，合并失败不能显示100%',async()=>{
 const values=[],client=load({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:8}}),readFile:o=>o.success({data:Buffer.alloc(o.length)})}),arrayBufferToBase64:b=>Buffer.from(b).toString('base64')});
 await assert.rejects(client.upload({name:'x.pdf',path:'file'},'/t',async(url)=>{if(url.endsWith('/uploads'))return {uploadId:'u',chunkSize:4};if(url.endsWith('/complete'))throw Error('保存失败');return {};},r=>values.push(r)),/保存失败/);
 assert.deepEqual(values.map(r=>r.progress),[0,50,99,99]);assert.match(values.at(-1).label,/合并/);
});

test('1.48MB真机文件各请求编码后小于100KB，超时只重试同一片，不重建项目',async()=>{
 const bytes=Buffer.alloc(Math.round(1.48*1024*1024),123),parts=[];let starts=0,completes=0,failed=false;
 const client=load({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:bytes.length}}),readFile:o=>o.success({data:bytes.subarray(o.position,o.position+o.length)})}),arrayBufferToBase64:b=>Buffer.from(b).toString('base64')});
 await client.upload({name:'招标文件正文.pdf',path:'file'},'/v1/tenders/T',async(url,method,data)=>{if(url.endsWith('/uploads')){starts++;return {uploadId:'u',chunkSize:48*1024};}if(url.endsWith('/complete')){completes++;return {};}
 assert.ok(Buffer.byteLength(JSON.stringify(data))<100*1024);if(data.index===1&&!failed){failed=true;throw Object.assign(Error('request timeout'),{cloudDetail:{code:102002}});}parts.push(data);return {};});
 assert.deepEqual(Buffer.concat(parts.map(p=>Buffer.from(p.base64,'base64'))),bytes);assert.equal(starts,1);assert.equal(completes,1);
});
test('旧后端超大分片在读文件前明确提示更新；网络失败最多尝试三次，不提交合并',async()=>{
 let reads=0,attempts=0,completes=0;const client=load({getFileSystemManager:()=>({stat:o=>o.success({stats:{size:10}}),readFile:o=>{reads++;o.success({data:Buffer.alloc(o.length)});}}),arrayBufferToBase64:b=>Buffer.from(b).toString('base64')});
 await assert.rejects(client.upload({name:'x.pdf',path:'x'},'/t',async()=>({uploadId:'u',chunkSize:256*1024})),/更新云托管后端/);assert.equal(reads,0);
 await assert.rejects(client.upload({name:'x.pdf',path:'x'},'/t',async(url)=>{if(url.endsWith('/uploads'))return {uploadId:'u',chunkSize:48*1024};if(url.endsWith('/parts')){attempts++;throw Error('network timeout');}completes++;}),/network timeout/);assert.equal(attempts,3);assert.equal(completes,0);
});
