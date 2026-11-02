'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
let pool;
function enabled(){return process.env.STORE_DRIVER==='mysql';}
function db(){
 if(pool)return pool;
 const address=process.env.MYSQL_ADDRESS||'', match=/^([^:]+):(\d+)$/.exec(address);
 if(!match||!process.env.MYSQL_USERNAME||!process.env.MYSQL_PASSWORD||!process.env.MYSQL_DATABASE)throw Error('MySQL 连接配置不完整');
 pool=require('mysql2/promise').createPool({host:match[1],port:Number(match[2]),user:process.env.MYSQL_USERNAME,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,charset:'utf8mb4',connectionLimit:8,connectTimeout:15000});
 return pool;
}
async function init(){
 await db().query('CREATE TABLE IF NOT EXISTS tender_entities (kind VARCHAR(16) NOT NULL, id VARCHAR(128) NOT NULL, body LONGTEXT NOT NULL, PRIMARY KEY(kind,id)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
}
async function read(connection){
 const [rows]=await connection.query('SELECT kind,id,body FROM tender_entities');
 const state={tenders:{},jobs:{}}, known=new Map();
 for(const row of rows){if(!state[row.kind])throw Error('数据库中存在未知记录类型');state[row.kind][row.id]=JSON.parse(row.body);known.set(row.kind+'/'+row.id,row.body);}
 return {state,known};
}
function state(fallback){return enabled()?(context.getStore()?.state||fallback):fallback;}
function owner(){return context.getStore()?.owner;}
function save(){
 const ctx=context.getStore();
 if(!ctx?.write)throw Error('云端数据只能在写入事务内修改');
 // 每次捕获不可变快照，避免后续修改与异步提交交错。
 const changes=[];
 for(const kind of ['tenders','jobs'])for(const [id,value]of Object.entries(ctx.state[kind])){
  const body=JSON.stringify(value),key=kind+'/'+id;
  if(body!==ctx.known.get(key)){ctx.known.set(key,body);changes.push([kind,id,body]);}
 }
 const task=ctx.tail.then(async()=>{
  if(!changes.length)return;
  await ctx.connection.beginTransaction();
  try{for(const values of changes)await ctx.connection.execute('INSERT INTO tender_entities(kind,id,body) VALUES (?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body)',values);await ctx.connection.commit();}
  catch(e){await ctx.connection.rollback();throw e;}
 });
 ctx.tail=task;task.catch(()=>{});return task;
}
function flush(){return save();}
async function run(write,fn,{wait=0,owner}={}){
 const connection=await db().getConnection();
 const lock='ai-tender:'+process.env.MYSQL_DATABASE;
 let locked=false;
 try{
  if(write){const [rows]=await connection.query('SELECT GET_LOCK(?,?) AS acquired',[lock,wait]);if(rows[0].acquired!==1)throw Object.assign(Error('服务正在处理其他任务，请稍后重试'),{statusCode:409});locked=true;}
  const loaded=await read(connection);
  const ctx={...loaded,connection,write,tail:Promise.resolve(),owner};
  return await context.run(ctx,async()=>{
   let result,error;
   try{result=await fn();}catch(e){error=e;}
   // 写任务的错误状态也必须持久化；提交错误优先，不能返回虚假的成功。
   if(write)await save();await ctx.tail;if(error)throw error;return result;
  });
 }finally{
  if(locked)await connection.query('SELECT RELEASE_LOCK(?)',[lock]).catch(()=>{});
  connection.release();
 }
}
async function close(){if(pool){await pool.end();pool=null;}}
module.exports={enabled,init,state,owner,save,flush,run,close};
