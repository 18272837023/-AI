'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/cloud-transport.js'),'utf8');
function load(wx){const module={exports:{}};vm.runInNewContext(source,{module,wx,getApp:()=>({globalData:{cloudHosting:{enabled:true,env:'env',service:'service'}}}),Promise,Error,Date});return module.exports;}
test('小程序云请求发送到指定环境和服务，不使用公网URL',async()=>{
 let sent;
 const client=load({cloud:{callContainer:o=>{sent=o;o.success({statusCode:200,data:{ok:true}});}}});
 assert.equal(client.enabled(),true);await client.call('/v1/tenders','POST',{name:'project'});
 assert.equal(sent.config.env,'env');assert.equal(sent.header['X-WX-SERVICE'],'service');assert.equal(sent.path,'/v1/tenders');assert.equal(sent.url,undefined);
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
test('分片导出按顺序写入真实文件并校验长度后打开，不依赖downloadFile公网域名',async()=>{
 const bytes=Buffer.from('PK-example-file'),written=[];let opened;
 const local={writeFileSync(){},appendFileSync:(p,b)=>written.push(Buffer.from(b)),unlinkSync(){}};
 const client=load({env:{USER_DATA_PATH:'private'},getFileSystemManager:()=>local,base64ToArrayBuffer:s=>Buffer.from(s,'base64'),openDocument:o=>{opened=o;o.success();}});
 await client.download('/v1/tenders/T','draft=1',async p=>p.includes('export?')?{downloadId:'d',size:bytes.length,parts:2,ext:'docx'}:{base64:(p.endsWith('0')?bytes.subarray(0,4):bytes.subarray(4)).toString('base64')});
 assert.deepEqual(Buffer.concat(written),bytes);assert.equal(opened.fileType,'docx');
});
