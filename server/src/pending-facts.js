'use strict';
const {MARKER,textOfBlock}=require('./marker-bindings');
const {needsUser,isPlanHedge}=require('./facts');
const keys=['approach','params','owner','frequency'];
function list(t){
 const found=new Map();
 const scan=(text,scoreId,title)=>{for(const m of String(text||'').matchAll(new RegExp(MARKER.source,'g'))){const marker=m[1].trim();if(!needsUser(marker)||isPlanHedge(marker))continue;let row=found.get(marker);if(!row){row={marker,chapters:[],count:0};found.set(marker,row);}row.count++;if(!row.chapters.includes(title))row.chapters.push(title);}};
 for(const g of t.elements||[])for(const r of g.rows||[])for(const key of keys)scan(r[key],g.scoreId,g.item);
 for(const s of t.sections||[])for(const b of s.blocks||[])scan(textOfBlock(b),s.scoreId,s.title);
 return [...found.values()];
}
function save(t,body){
 const bad=(message,statusCode=400)=>{throw Object.assign(Error(message),{statusCode});};
 if(!body||typeof body!=='object'||Array.isArray(body))bad('无效的待确认资料');
 if(body.revision!==(t.revision||0))bad('项目已变化，请重新载入后保存',409);
 const allowed=new Set(list(t).map(f=>f.marker));
 if(!Array.isArray(body.values)||!body.values.length||body.values.length>500)bad('请填写需要确认的真实资料');
 const answers=new Map();
 for(const row of body.values){if(!row||typeof row!=='object'||!allowed.has(row.marker)||answers.has(row.marker))bad('待确认字段已变化，请重新载入');if(typeof row.value!=='string'||!row.value.trim()||row.value.length>6000||/〔待确认/.test(row.value))bad('请填写不含待确认标记的真实资料（不超过6000字）');answers.set(row.marker,row.value.trim());}
 const replace=text=>String(text||'').replace(new RegExp(MARKER.source,'g'),(full,key)=>answers.get(key.trim())||full);
 const elements=JSON.parse(JSON.stringify(t.elements||[])),sections=JSON.parse(JSON.stringify(t.sections||[]));
 for(const g of elements)for(const r of g.rows)for(const key of keys)r[key]=replace(r[key]);
 for(const s of sections){for(const b of s.blocks){b.text=replace(b.text);if(b.rows)b.rows=b.rows.map(row=>row.map(replace));}s.plain=s.blocks.map(textOfBlock).join('\n');s.wordCount=s.plain.replace(/\s/g,'').length;}
 const patch={...(t.elements?{elements}:{}),...(t.sections?{sections}:{}),confirmedFacts:[...(t.confirmedFacts||[]),...body.values.map(row=>({marker:row.marker,value:row.value.trim(),at:new Date().toISOString()}))].slice(-500)};
 if(t.sections)patch.check=require('./rules/check').checkAll({...t,...patch});
 const store=require('./lib/store');store.updateTender(t.id,patch);store.flush();return {revision:t.revision,pendingFacts:list(t),check:t.check};
}
module.exports={list,save};
