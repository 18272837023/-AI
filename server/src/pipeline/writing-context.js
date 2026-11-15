'use strict';
const compact=s=>String(s||'').replace(/\s/g,'');
function terms(text){
 const result=new Set(),ignored=new Set(['方案','措施','要求','服务','技术','本项','项目','进行','相关','内容','管理']);
 for(const word of String(text||'').match(/[\u4e00-\u9fff]+|[A-Za-z][A-Za-z0-9_-]+/g)||[]){if(word.length>2)result.add(word);for(let i=0;i<word.length-1;i++){const t=word.slice(i,i+2);if(!ignored.has(t))result.add(t);}}
 return [...result];
}
function selectSources(sections,group,maxChars=16000){
 const fragments=[];
 for(let i=0;i<(sections||[]).length;i++){
  const s=sections[i];if(s.fromAttachment&&/工作表：/.test(s.title||''))continue;
  const body=String(s.text||'');for(let offset=0;offset<body.length;offset+=1200)fragments.push({id:'S'+i+'-'+offset,page:s.page??null,section:[s.no,s.title].filter(Boolean).join(' '),quote:body.slice(offset,offset+1500)});
 }
 const pools=(group.rows||[]).map(row=>{const keys=terms([group.item,row.name,row.mustHave].join(' '));return {row,candidates:fragments.map(f=>({...f,rank:keys.reduce((n,k)=>n+(compact(f.section).includes(k)?3:0)+(compact(f.quote).includes(k)?1:0),0)})).filter(f=>f.rank>0).sort((a,b)=>b.rank-a.rank||a.id.localeCompare(b.id))};});
 const chosen=new Map();let used=0;
 // 每条要素先保留自己的命中资料，防止通用要求挤掉专业条款。
 for(let round=0;round<3;round++)for(const pool of pools){const f=pool.candidates[round];if(!f)continue;const old=chosen.get(f.id);if(old){if(!old.elementIds.includes(pool.row.elementId))old.elementIds.push(pool.row.elementId);continue;}const cost=f.quote.length+f.section.length+80;if(used+cost>maxChars)continue;chosen.set(f.id,{id:f.id,page:f.page,section:f.section,quote:f.quote,elementIds:[pool.row.elementId]});used+=cost;}
 const evidence=[...chosen.values()];return {source:evidence.map(e=>`【${e.id} ${e.section}｜${e.page?'P'+e.page:'页码未知'}】\n${e.quote}`).join('\n\n'),evidence};
}
function chapterContext(t,group){
 const bp=(t.blueprint||[]).find(b=>String(b.scoreId)===String(group.scoreId)),score=(t.parse?.scores||[]).find(s=>String(s.id)===String(group.scoreId));
 const enriched={...group,rows:(group.rows||[]).map(row=>({...row,mustHave:bp?.elements?.find(e=>e.id===row.elementId)?.mustHave||row.mustHave||''}))};
 const selected=selectSources(t.doc?.sections||[],enriched);
 return {project:t.parse?.project||{},qualifications:(t.parse?.qualifications||[]).filter(q=>q.resp==='tech'),outline:t.parse?.outline,chapters:t.blueprint||t.elements,scoreId:group.scoreId,scoreCriteria:{score:bp?.score??score?.score,tierDesc:bp?.tierDesc||score?.tierDesc||'',evidence:score?.evidence},requiredElements:enriched.rows.map(r=>({elementId:r.elementId,name:r.name,mustHave:r.mustHave})),source:selected.source,sourceEvidence:selected.evidence,billOfQuantities:require('./attachment-context').attachmentContext(t.doc?.sections||[],group.item)};
}
module.exports={terms,selectSources,chapterContext};
