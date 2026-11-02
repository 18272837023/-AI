'use strict';
function enabled(){return !!getApp().globalData.cloudHosting?.enabled&&typeof wx.cloud?.callContainer==='function';}
function call(path,method,data){
 const config=getApp().globalData.cloudHosting;
 return new Promise((resolve,reject)=>wx.cloud.callContainer({config:{env:config.env},path,method,data,header:{'X-WX-SERVICE':config.service,'content-type':'application/json'},timeout:60000,success:resolve,fail:()=>reject(Error('无法连接云托管服务，请确认服务部署及小程序关联状态'))}));
}
function read(fs,filePath,position,length){return new Promise((resolve,reject)=>fs.readFile({filePath,position,length,success:r=>resolve(r.data),fail:()=>reject(Error('读取文件失败，请重新选择文件'))}));}
async function upload(file,base,request){
 const fs=wx.getFileSystemManager();
 const stat=await new Promise((resolve,reject)=>fs.stat({path:file.path,success:r=>resolve(r.stats),fail:reject}));
 const size=stat.size;
 const session=await request(base+'/uploads','POST',{name:file.name,size});
 for(let position=0,index=0;position<size;position+=session.chunkSize,index++){
  const data=await read(fs,file.path,position,Math.min(session.chunkSize,size-position));
  await request(base+'/uploads/'+session.uploadId+'/parts','POST',{index,base64:wx.arrayBufferToBase64(data)});
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
