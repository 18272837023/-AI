'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const config=require('../config');
let cos;
function enabled(){return process.env.FILE_STORE==='cos';}
function params(key){
 if(!process.env.COS_BUCKET||!process.env.COS_REGION)throw Error('对象存储配置不完整');
 if(!/^[a-zA-Z0-9_./-]+$/.test(key)||key.includes('..'))throw Error('无效存储路径');
 return {Bucket:process.env.COS_BUCKET,Region:process.env.COS_REGION,Key:'ai-tender/'+key};
}
async function credentials(){
 const response=await fetch('http://api.weixin.qq.com/_/cos/getauth',{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('无法获取对象存储临时凭证，请检查云调用权限');
 const value=await response.json();
 if(!value.TmpSecretId||!value.TmpSecretKey||!value.Token||!Number.isFinite(Number(value.ExpiredTime)))throw Error('对象存储临时凭证无效，请在云调用中添加 /_/cos/getauth');
 return {TmpSecretId:value.TmpSecretId,TmpSecretKey:value.TmpSecretKey,SecurityToken:value.Token,ExpiredTime:Number(value.ExpiredTime)};
}
function client(){
 if(!cos)cos=new(require('cos-nodejs-sdk-v5'))({getAuthorization:(_,callback)=>credentials().then(value=>callback(value),error=>callback({error})),Timeout:30000});
 return cos;
}
async function put(key,buffer){
 if(enabled()){await client().putObject({...params(key),Body:buffer});return;}
 if(!/^[a-zA-Z0-9_./-]+$/.test(key)||key.includes('..'))throw Error('无效存储路径');
 await fs.mkdir(path.dirname(path.join(config.uploadDir,key)),{recursive:true});await fs.writeFile(path.join(config.uploadDir,key),buffer);
}
async function get(key){
 if(enabled()){const result=await client().getObject(params(key));return Buffer.from(result.Body);}
 return fs.readFile(path.join(config.uploadDir,key));
}
async function remove(key){if(enabled())await client().deleteObject(params(key));else await fs.unlink(path.join(config.uploadDir,key)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
module.exports={enabled,put,get,remove,credentials};
