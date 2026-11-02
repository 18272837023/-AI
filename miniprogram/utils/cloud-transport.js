'use strict';
function enabled(){return !!getApp().globalData.cloudHosting?.enabled&&typeof wx.cloud?.callContainer==='function';}
function failure(error,path,method,config){
 const code=error?.errCode??error?.code;
 const raw=String(error?.errMsg||error?.message||'微信未返回具体错误信息').replace(/sk-[A-Za-z0-9_-]+/g,'[密钥已隐藏]').slice(0,500);
 const phase=/\/parts$/.test(path)?'上传文件分片':/\/complete$/.test(path)?'合并上传文件':/\/uploads$/.test(path)?'准备上传':path==='/v1/tenders'&&method==='POST'?'创建项目':'云托管请求';
 const result=Error(phase+'失败'+(code!==undefined?'（错误码 '+code+'）':'')+'：'+raw);
 result.cloudDetail={code,phase,env:config.env,service:config.service,callID:error?.callID||error?.requestId||'',errMsg:raw};
 return result;
}
function call(path,method,data){
 const config=getApp().globalData.cloudHosting;
 return new Promise((resolve,reject)=>{
  let settled=false;
  const success=value=>{if(!settled){settled=true;resolve(value);}};
  const fail=error=>{if(settled)return;settled=true;const detailed=failure(error,path,method,config);console.error('[云托管调用失败]',detailed.cloudDetail);reject(detailed);};
  try{
   const task=wx.cloud.callContainer({config:{env:config.env},path,method,data,header:{'X-WX-SERVICE':config.service,'content-type':'application/json'},timeout:60000,success,fail});
   if(task&&typeof task.then==='function')task.then(success,fail);
  }catch(error){fail(error);}
 });
}
function read(fs,filePath,position,length){return new Promise((resolve,reject)=>fs.readFile({filePath,position,length,success:r=>resolve(r.data),fail:()=>reject(Error('读取文件失败，请重新选择文件'))}));}
async function sendPart(request,url,data){
 for(let attempt=0;attempt<3;attempt++)try{return await request(url,'POST',data);}catch(e){
  // 同一 uploadId/index 可重复提交；业务写入和新建项目不做自动重试。
  if(attempt===2||!(Number(e.cloudDetail?.code)===102002||/timeout|network|网络|超时/i.test(e.message)))throw e;
  await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
 }
}
async function upload(file,base,request){
 const fs=wx.getFileSystemManager();
 const stat=await new Promise((resolve,reject)=>fs.stat({path:file.path,success:r=>resolve(r.stats),fail:reject}));
 const size=stat.size;
 const session=await request(base+'/uploads','POST',{name:file.name,size});
 if(!Number.isInteger(session.chunkSize)||session.chunkSize<=0||session.chunkSize>48*1024)throw Error('上传服务版本过旧，请管理员先更新云托管后端，再上传文件');
 for(let position=0,index=0;position<size;position+=session.chunkSize,index++){
  const data=await read(fs,file.path,position,Math.min(session.chunkSize,size-position));
  await sendPart(request,base+'/uploads/'+session.uploadId+'/parts',{index,base64:wx.arrayBufferToBase64(data)});
 }
 return request(base+'/uploads/'+session.uploadId+'/complete','POST',{});
}
async function download(base,query,request){
 const result=await request(base+'/export?'+query+'&cloud=1');
 const fs=wx.getFileSystemManager(),filePath=wx.env.USER_DATA_PATH+'/technical-bid-'+Date.now()+'.'+result.ext;
 try{
  fs.writeFileSync(filePath,'','utf8');
  let bytes=0;
  for(let index=0;index<result.parts;index++){
   const part=await request(base+'/export-parts?downloadId='+encodeURIComponent(result.downloadId)+'&index='+index);
   const data=wx.base64ToArrayBuffer(part.base64);bytes+=data.byteLength;fs.appendFileSync(filePath,data);
  }
  if(bytes!==result.size)throw Error('导出文件下载不完整，请重试');
  await new Promise((resolve,reject)=>wx.openDocument({filePath,fileType:result.ext,showMenu:true,success:resolve,fail:()=>reject(Error('文件打开失败'))}));
 }catch(e){try{fs.unlinkSync(filePath);}catch(_){}throw e;}
}
module.exports={enabled,call,upload,download};
