'use strict';
const {MARKER,needsUser,isPlanHedge}=require('./facts');
const same=(a,b)=>String(a)===String(b);
function textOf(section){return (section.blocks||[]).map(b=>b.type==='table'?[b.text,...(b.rows||[]).map(r=>r.join(' | '))].join('\n'):b.text||'').join('\n');}
function planRepair(t,issues){
 const sections=t.sections||[],bp=t.blueprint||[],candidates=[...sections],created=new Set();
 const requested=new Set(issues.filter(i=>i.cat==='cover'&&i.id!=='C0').map(i=>String(i.scoreId??(i.id.startsWith('C2-')?i.id.slice(3):''))));
 const empty=issues.some(i=>i.id==='C0');
 for(const row of bp){
  if((empty||requested.has(String(row.scoreId)))&&!sections.some(s=>same(s.scoreId,row.scoreId))){
   candidates.push({scoreId:row.scoreId,title:row.item,blocks:[],plain:'',wordCount:0});created.add(String(row.scoreId));
  }
 }
 for(const id of requested)if(id&&!bp.some(b=>same(b.scoreId,id)))throw Error(`评分项 ${id} 的施工图不存在，请先重新确认施工图，再补写对应章节`);
 if(empty&&!bp.length&&!sections.length)throw Error('尚未生成施工图，请先确认解析结果和施工图，再生成正文');
 const targets=candidates.filter((s,index)=>issues.some(i=>{
  if(i.id==='C0')return !(s.blocks||[]).some(b=>b.type!=='h4'&&b.text?.trim());
  if(i.cat==='cover')return same(i.scoreId??(i.id.startsWith('C2-')?i.id.slice(3):''),s.scoreId);
  if(i.cat==='compliance'||i.cat==='style')return !created.has(String(s.scoreId));
  if(i.cat==='placeholder')return [...textOf(s).matchAll(new RegExp(MARKER.source,'g'))].some(m=>!needsUser(m[1])||isPlanHedge(m[1]));
  if(i.cat==='qual')return index===0||(t.parse?.qualifications||[]).some(q=>q.resp==='tech'&&q.anchor&&s.title?.includes(q.anchor));
  return false;
 }));
 // 缺章按施工图顺序调度，不依靠标题或“第几章”的展示文案定位。
 const order=new Map(bp.map((b,i)=>[String(b.scoreId),i]));
 targets.sort((a,b)=>(order.get(String(a.scoreId))??Infinity)-(order.get(String(b.scoreId))??Infinity));
 return {targets,created};
}
function putSection(sections,next,bp){
 const index=sections.findIndex(s=>same(s.scoreId,next.scoreId));
 if(index>=0){sections[index]=next;return;}
 const order=new Map((bp||[]).map((b,i)=>[String(b.scoreId),i])),rank=order.get(String(next.scoreId));
 const following=sections.findIndex(s=>(order.get(String(s.scoreId))??-1)>rank);
 sections.splice(following<0?sections.length:following,0,next);
}
module.exports={planRepair,putSection,textOf,same};
