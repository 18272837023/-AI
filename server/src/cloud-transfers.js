'use strict';
const {id}=require('./lib/util');
const store=require('./lib/store');
const files=require('./lib/files');
const {readJson,ok}=require('./lib/http');
const {detectExt}=require('./parse');
const config=require('./config');
// 微信私有 callContainer 请求限制按编码后包体计算：48KB → Base64 64KB。
const CHUNK=48*1024;
function bad(message){throw Object.assign(Error(message),{statusCode:400});}
function routes(requireTender,assertIdle,persistUpload){return [
 {method:'POST',path:'/v1/tenders/:id/uploads',async handler({req,res,params}){
  const t=requireTender(params);assertIdle(t.id);const body=await readJson(req);
  if(typeof body.name!=='string'||body.name.length>200||!detectExt(body.name))bad('文件名称或类型无效');
  if(!Number.isSafeInteger(body.size)||body.size<=0||body.size>config.maxFileMB*1024*1024)bad(`文件大小应在 ${config.maxFileMB}MB 以内`);
  const pending={...t.pendingUploads};
  for(const [key,value]of Object.entries(pending))if(value.expires<Date.now())delete pending[key];
  if(Object.keys(pending).length>=10)bad('未完成的上传过多，请先完成已有上传');
  const uploadId=id('upload');pending[uploadId]={name:body.name,size:body.size,parts:Math.ceil(body.size/CHUNK),received:[],expires:Date.now()+6*3600000};
  store.updateTender(t.id,{pendingUploads:pending});ok(res,{uploadId,chunkSize:CHUNK});
 }},
 {method:'POST',path:'/v1/tenders/:id/uploads/:uploadId/parts',async handler({req,res,params}){
  const t=requireTender(params);assertIdle(t.id);const u=t.pendingUploads?.[params.uploadId],b=await readJson(req);
  if(!u||u.expires<Date.now())bad('上传已过期，请重新选择文件');
  if(!Number.isInteger(b.index)||b.index<0||b.index>=u.parts||typeof b.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64))bad('无效文件分片');
  const data=Buffer.from(b.base64,'base64'),expected=b.index===u.parts-1?u.size-b.index*CHUNK:CHUNK;
  if(data.length!==expected)bad('文件分片长度不正确');
  await files.put(`chunks/${params.uploadId}/${b.index}`,data);
  if(!u.received.includes(b.index))u.received.push(b.index);
  store.updateTender(t.id,{pendingUploads:t.pendingUploads});ok(res,{received:u.received.length});
 }},
 {method:'POST',path:'/v1/tenders/:id/uploads/:uploadId/complete',async handler({res,params}){
  const t=requireTender(params);assertIdle(t.id);const u=t.pendingUploads?.[params.uploadId];
  if(!u||u.expires<Date.now())bad('上传已过期，请重新选择文件');
  if(u.file)return ok(res,u.file);
  if(u.received.length!==u.parts)bad('文件尚未上传完整');
  const buffers=[];for(let i=0;i<u.parts;i++)buffers.push(await files.get(`chunks/${params.uploadId}/${i}`));
  const data=Buffer.concat(buffers);if(data.length!==u.size)bad('文件长度校验失败');
  const result=await persistUpload(t,u.name,data);
  u.file=result;store.updateTender(t.id,{pendingUploads:t.pendingUploads});
  await store.flush();
  for(let i=0;i<u.parts;i++)await files.remove(`chunks/${params.uploadId}/${i}`).catch(()=>{});
  ok(res,result);
 }},
 {method:'GET',path:'/v1/tenders/:id/export-parts',async handler({res,params,query}){
  const t=requireTender(params),record=t.cloudDownloads?.[query.get('downloadId')],index=Number(query.get('index'));
  if(!record||record.expires<Date.now())bad('下载已过期，请重新导出');
  if(!Number.isInteger(index)||index<0||index*CHUNK>=record.size)bad('无效下载分片');
  const data=await files.get(record.key);
  ok(res,{base64:data.subarray(index*CHUNK,(index+1)*CHUNK).toString('base64')});
 }}
];}
async function exportFile(t,data,ext){
 const downloadId=id('download'),key=`exports/${t.id}/${downloadId}.${ext}`;
 await files.put(key,data);
 const records={};for(const [key,value]of Object.entries(t.cloudDownloads||{}))if(value.expires>Date.now())records[key]=value;
 records[downloadId]={key,size:data.length,expires:Date.now()+3600000};
 store.updateTender(t.id,{cloudDownloads:records});
 return {downloadId,size:data.length,parts:Math.ceil(data.length/CHUNK),ext};
}
module.exports={routes,exportFile,CHUNK};
