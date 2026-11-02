'use strict';
const store = require('./lib/store');
const llm = require('./lib/llm');
const f = (key,label,ph='',extra={}) => ({key,label,ph,type:'text',value:'',...extra});
// 待补字段只有 F1—F3 三组固定入口；现场条件、拟投入配置等由 AI 在生成阶段写实，不再问用户。
const TEMPLATES = [
 {id:'F1',name:'项目经历补充',repeat:true,unit:'项目',max:6,canDeclare:true,pattern:/类似项目|项目经历|类似业绩|同类.{0,6}经验/,
  hint:'一个真实合同填一条。时间、金额按合同原文填写；是否符合评分条件请对照本项目招标文件。',
  fields:[f('name','项目名称','填写真实项目名称',{required:false}),f('type','项目类型','填写真实项目类型'),f('signDate','合同签订时间','按合同填写，如：2024-06'),f('amount','合同金额（万元）','按真实合同填写'),f('status','实施情况','',{type:'chips',options:['已完成','在建','已中标未开工']})]},
 {id:'F2',name:'供应商与人员入场时间',repeat:false,unit:'计划',max:1,canDeclare:true,pattern:/进场|到场|人员|劳动力|岗位.*配置|资源配置/,
  hint:'只填三个数：供应商什么时候进场、现场最多多少人、人从哪里来。各岗位的到场细节由 AI 按施工进度安排，不需要你逐个填。',
  fields:[f('vendor','供应商进场时间','如：开工前 7 日'),f('peak','现场作业人数峰值','按实际资源计划填写'),f('source','人员来源','如：自有团队、劳务分包')]},
 {id:'F3',name:'培训与考核',repeat:true,unit:'培训维度',max:6,canDeclare:true,aiPolish:true,pattern:/培训|考核|教育|交底/,
  hint:'一个培训对象或维度填一条。AI 可拟定计划建议，需你确认后保存；不会当作已经实施的培训记录。',
  fields:[f('subject','培训对象','按实际安排填写'),f('content','培训内容','填写需要开展的培训内容',{type:'textarea'}),f('freq','频次与学时','按拟实施计划填写'),f('check','考核方式','如：笔试、实操、现场抽查'),f('fail','不合格处置','按拟实施计划填写',{type:'textarea'})]}
];
const MARKER = /〔待确认[:：]([^〕]+)〕/g;
function contextRows(t) {
 const rows=(t.blueprint||[]).flatMap(g=>(g.elements||[]).map(e=>{const row=(t.elements||[]).find(x=>x.scoreId===g.scoreId)?.rows?.find(r=>r.elementId===e.id);return {scoreId:g.scoreId,elementId:e.id,chapter:g.item,name:e.name,text:[e.name,e.mustHave,row?.approach,row?.params,row?.owner,row?.frequency].filter(Boolean).join('\n')};}));
 for(const sec of t.sections||[])for(const b of sec.blocks||[]){const text=require('./marker-bindings').textOfBlock(b);if(/〔待确认/.test(text))rows.push({scoreId:sec.scoreId,elementId:b.covers?.[0]||'',chapter:sec.title,name:'正文待确认事实',text,fromBody:true});}
 // 用户已经回答的问题仍可回来修改；AI 自行解决的旧底稿问题不重新提问。
 for(const change of t.supplementReplacements||[]){const sec=(t.sections||[]).find(s=>s.scoreId===change.scoreId),block=sec?.blocks.find(b=>b.text===change.after);if(block)rows.push({scoreId:sec.scoreId,elementId:block.covers?.[0]||'',chapter:sec.title,name:'已填写真实资料',text:[change.before,...(change.beforeRows||[]).flat()].join('\n'),fromBody:true});}
 for(const change of t.supplementElementReplacements||[])rows.push({scoreId:change.scoreId,elementId:change.elementId,chapter:(t.elements||[]).find(g=>g.scoreId===change.scoreId)?.item||'',text:change.before,fromBody:true});
 return rows;
}
function getGroups(t) {
 const rows=contextRows(t), saved=t.supplementValues||[];
 const groups=[];
 for(const def of TEMPLATES.slice(0,3)) {
  let targets=rows.filter(r=>def.pattern.test(r.text));
  // 三个核心入口是产品固定流程，不能因模型漏抽关键词而消失。
  if(!targets.length){const section=(t.sections||[]).find(s=>/团队|组织|管理|实施/.test(s.title))||(t.sections||[])[0];const fallback=rows.find(r=>/团队|组织|管理|实施/.test(r.chapter))||rows[0];targets=section?[{scoreId:section.scoreId,elementId:'',chapter:section.title}]:fallback?[fallback]:[];}
  groups.push({...def,pattern:undefined,fields:def.fields.map(field=>({...field,required:field.type!=='label'&&field.required!==false,markers:[]})),targets});
 }
 // 待补字段只保留固定字段，不再把正文里的〔待确认〕逐条转成用户问题。
 // 拟投入配置、设备清单、供应商与入场计划、移交界面、「以…为准」这类内容，
 // 投标阶段本来就写不出唯一精确值，归 AI 写实（见 facts.isPlanHedge）；
 // 只有能对到固定字段的真实事实才做绑定，例如人数峰值、进场时间、培训频次。
 for(const r of rows){
  for(const m of r.text.matchAll(new RegExp(MARKER.source,'g'))){
   const marker=m[1].trim();
   const known=require('./marker-bindings').bindingFor(marker);
   if(!known)continue;
   const field=groups.find(g=>g.id===known.groupId).fields.find(f=>f.key===known.key);
   let binding=field.markers.find(b=>b.marker===marker);
   if(!binding){binding={marker,targets:[],groupValue:!!known.groupValue};field.markers.push(binding);}
   binding.targets.push(r);if(!known.groupValue)field.required=true;
  }
 }
 return groups.map(def=>{
  const record=saved.find(g=>g.id===def.id);
  const entries=record?.entries?.length?record.entries:[{id:def.id+'-1',values:{}}];
  return {...def,el:def.id,chapter:[...new Set(def.targets.map(r=>r.chapter))].join('、'),declared:!!record?.declared,entries:entries.map(e=>({id:e.id,fields:def.fields.map(field=>({...field,value:e.values?.[field.key]||field.legacyValue||''}))}))};
 });
}
function stats(groups) {
 const inputs=groups.filter(g=>!g.declared).flatMap(g=>g.entries.flatMap(e=>e.fields.filter(f=>f.type!=='label')));
 return {groups:groups.length,fields:inputs.length,filled:inputs.filter(f=>f.value.trim()).length,pending:inputs.filter(f=>f.required&&!f.value.trim()).length,pendingGroups:groups.filter(g=>!g.declared&&g.entries.some(e=>e.fields.some(f=>f.required&&!f.value.trim()))).length,declared:groups.filter(g=>g.declared).length};
}
function bad(message,code=400){throw Object.assign(new Error(message),{statusCode:code});}
function validateInput(t,body) {
 if(!Number.isInteger(body.revision)||body.revision!==(t.revision||0))bad('项目已变化，请重新载入后保存',409);
 const definitions=getGroups(t);
 if(!Array.isArray(body.groups)||body.groups.length!==definitions.length||new Set(body.groups.map(g=>g.id)).size!==definitions.length)bad('请完整提交当前补充清单');
 return definitions.map(def=>{
  const input=body.groups.find(g=>g.id===def.id);if(!input)bad('补充清单已变化，请重新载入');
  if(typeof input.declared!=='boolean'||input.declared&&!def.canDeclare)bad('该项不能声明不适用');
  if(!Array.isArray(input.entries)||input.entries.length<1||input.entries.length>def.max)bad('条目数量不符合要求');
  const keys=def.fields.filter(f=>f.type!=='label').map(f=>f.key);
  return {id:def.id,declared:input.declared,entries:input.entries.map((entry,i)=>{
   if(!Array.isArray(entry.fields))bad('缺少填写字段');
   if(entry.fields.some(f=>!def.fields.some(d=>d.key===f.key))||new Set(entry.fields.map(f=>f.key)).size!==entry.fields.length)bad('包含未知或重复字段');
   const values={};for(const key of keys){const value=entry.fields.find(f=>f.key===key)?.value;if(typeof value!=='string'||value.length>6000)bad('字段应为不超过 6000 字的文本');const field=def.fields.find(f=>f.key===key);if(value&&field.type==='chips'&&!field.options.includes(value))bad('请选择有效选项');values[key]=value.trim();}
   return {id:def.id+'-'+(i+1),values};
  })};
 });
}
/**
 * 把用户填的事实写成正文句子，而不是"标签：值；标签：值"的填空表。
 * 投标文件里出现表单式拼接，评委一眼能看出是凑的。
 */
function renderGroup(g) {
 if(g.declared)return '';
 return g.entries.map((e,i)=>{
  const v={};for(const f of e.fields)if(f.type!=='label'&&f.value&&f.value.trim())v[f.key]=f.value.trim();
  if(!Object.keys(v).length)return '';
  if(g.id==='F1'){
   const parts=[];
   if(v.name)parts.push(v.name);
   if(v.type)parts.push(v.type);
   if(v.signDate)parts.push(`${v.signDate} 签订`);
   if(v.amount)parts.push(`合同金额 ${v.amount} 万元`);
   if(v.status)parts.push(v.status==='已完成'?'已竣工验收':v.status);
   return `投标人完成的类似项目${g.entries.length>1?'（'+(i+1)+'）':''}：${parts.join('，')}。`;
  }
  if(g.id==='F2'){
   const s=[];
   if(v.vendor)s.push(`供应商于${v.vendor}进场`);
   if(v.peak)s.push(`现场作业人数峰值 ${v.peak} 人`);
   if(v.source)s.push(`人员来源为${v.source.replace(/为主/g,'').replace(/[，,]\s*$/,'')}`);
   let text='项目部按施工进度分批组织人员进场';
   if(s.length)text+=`，${s.join('，')}`;
   text+='。';
   // 现场实测类事实（现场查勘、周边条件、资源投入）按句追加
   const extra=Object.entries(v).filter(([k])=>!['vendor','peak','source'].includes(k)).map(([,val])=>val);
   if(extra.length)text+=extra.map((x)=>/[。；]$/.test(x)?x:x+'。').join('');
   return text;
  }
  if(g.id==='F3'){
   const s=[];
   if(v.subject)s.push(`培训对象为${v.subject}`);
   if(v.content)s.push(`内容为${v.content}`);
   if(v.freq)s.push(`安排${v.freq}`);
   if(v.check)s.push(`采用${v.check}考核`);
   if(v.fail)s.push(`不合格者${v.fail}`);
   return `培训与考核${g.entries.length>1?'（'+(i+1)+'）':''}：${s.join('，')}。`;
  }
  // 其他分组：保持可读的叙述，不用冒号堆砌
  const list=e.fields.filter(f=>f.type!=='label'&&f.value&&f.value.trim()).map(f=>`${f.label}为${f.value.trim()}`);
  return list.length?`${g.name}：${list.join('，')}。`:'';
 }).filter(Boolean).join('');
}
function applyToSections(t,groups=getGroups(t),fresh=false) {
 const sections=JSON.parse(JSON.stringify(t.sections||[])), warnings=[], replacements=[];
 if(!fresh)for(const change of t.supplementReplacements||[]){const sec=sections.find(s=>s.scoreId===change.scoreId);const block=sec?.blocks.find(b=>!b.supplementGroupId&&b.text===change.after&&(!change.afterRows||JSON.stringify(b.rows)===JSON.stringify(change.afterRows)));if(block){block.text=change.before;if(change.beforeRows)block.rows=change.beforeRows;}else if(sec)warnings.push('存在已人工编辑的段落，保留原文，请核对补充信息是否一致');}
 const answered=require('./marker-bindings').answersOf(groups);

 // 每组事实只写进一个主章节：全章重复会让正文像拼贴。
 // 主章节取该组 targets 里第一个在正文中真实存在的 scoreId。
 const primaryOf={};
 for(const g of groups){
  const hit=g.targets.map(r=>r.scoreId).find(id=>sections.some(s=>s.scoreId===id));
  if(hit)primaryOf[g.id]=hit;
 }

 for(const sec of sections){
  const manualGroups=new Set();
  sec.blocks=sec.blocks.filter(b=>{if(!b.supplementGroupId)return true;if(b.text===b.supplementValueText)return false;manualGroups.add(b.supplementGroupId);return true;});
  for(const block of sec.blocks){if(block.supplementGroupId)continue;const before=block.text,beforeRows=block.rows?JSON.parse(JSON.stringify(block.rows)):undefined;
   block.text=require('./marker-bindings').replace(block.text,sec.scoreId,answered);
   if(block.rows)block.rows=block.rows.map(row=>row.map(cell=>require('./marker-bindings').replace(cell,sec.scoreId,answered)));
   if(before!==block.text||JSON.stringify(beforeRows)!==JSON.stringify(block.rows))replacements.push({scoreId:sec.scoreId,before,after:block.text,...(beforeRows?{beforeRows,afterRows:block.rows}:{})});
  }
  for(const g of groups){
   if(primaryOf[g.id]!==sec.scoreId)continue;
   const targets=g.targets.filter(r=>r.scoreId===sec.scoreId),text=renderGroup(g);
   if(!targets.length||!text)continue;
   if(manualGroups.has(g.id)){warnings.push(`「${sec.title}」中的${g.name}已人工编辑，未覆盖，请核对新保存的信息`);continue;}
   sec.blocks.push({type:'p',text,covers:[...new Set(targets.map(r=>r.elementId).filter(Boolean))],supplementGroupId:g.id,supplementValueText:text});
  }
  sec.plain=sec.blocks.map(b=>b.type==='table'?[b.text,...(b.rows||[]).map(r=>r.join(' | '))].join('\n'):b.text).join('\n');sec.wordCount=sec.plain.replace(/\s/g,'').length;
 }
 return {sections,replacements,warnings:[...new Set(warnings)]};
}
function save(t,body) {
 const values=validateInput(t,body), proposed={...t,supplementValues:values};
 const applied=applyToSections(proposed);
 const elementResult=applyToElements(proposed);
 const patch={supplementValues:values,supplementWarnings:applied.warnings,supplementReplacements:applied.replacements,supplementElementReplacements:elementResult.replacements};
 if(t.elements)patch.elements=elementResult.elements;
 if(t.sections)patch.sections=applied.sections;
 const next={...proposed,...patch};if(t.sections)patch.check=require('./rules/check').checkAll(next);
 store.updateTender(t.id,patch);store.flush();
 return {revision:t.revision,groups:getGroups(t),stats:stats(getGroups(t)),check:t.check,warnings:applied.warnings};
}
function applyToElements(t,groups=getGroups(t)){
 const elements=JSON.parse(JSON.stringify(t.elements||[])),replacements=[];
 for(const old of t.supplementElementReplacements||[]){const row=elements.find(g=>String(g.scoreId)===String(old.scoreId))?.rows.find(r=>r.elementId===old.elementId);if(row?.[old.key]===old.after)row[old.key]=old.before;}
 const answers=require('./marker-bindings').answersOf(groups);
 for(const group of elements)for(const row of group.rows)for(const key of ['approach','params','owner','frequency']){
  const before=row[key];row[key]=require('./marker-bindings').replace(before,group.scoreId,answers);
  if(before!==row[key])replacements.push({scoreId:group.scoreId,elementId:row.elementId,key,before,after:row[key]});
 }
 return {elements,replacements};
}
function declarationWarnings(t) {
 return getGroups(t).filter(g=>g.declared).map(g=>({id:'SUP-'+g.id,level:'warn',cat:'supplement',title:`${g.name}已声明未提供或不适用`,detail:'这是用户声明，不代表满足招标要求；原文的强制要求和未清除占位符仍按正常规则检查。',fixType:'manual',count:1,samples:[]}));
}
async function trainingDraft(t) {
 const group=getGroups(t).find(g=>g.id==='F3');if(!group)bad('当前项目没有识别到培训要求');
 const keys=['subject','content','freq','check','fail'];
 const schema={type:'object',required:['items'],properties:{items:{type:'array',minItems:2,maxItems:6,items:{type:'object',required:keys,additionalProperties:false,properties:Object.fromEntries(keys.map(k=>[k,{type:'string'}]))}}}};
 const result=await llm.runUnit({name:'培训计划建议',schema,timeoutMs:20000,maxRetries:1,system:'你是技术标编制助手。仅拟定未来培训计划建议，不得编造已完成培训、人员资质或企业已有制度。只输出 JSON。',user:JSON.stringify({task:'按本项目培训要求拟定2—6条培训计划建议，字段subject培训对象/content内容/freq频次学时/check考核方式/fail不合格处置。建议需要用户确认。',project:{...t.parse?.project,name:t.name},requirements:group.targets.map(r=>r.text),chapterContext:(t.sections||[]).filter(s=>/施工|实施|管理/.test(s.title)).slice(0,2).map(s=>s.plain.slice(0,4000))}),fallback:async()=>({items:[{subject:'进场作业人员',content:'项目安全要求与作业交底',freq:'',check:'',fail:''},{subject:'项目管理人员',content:'质量管理与应急处置',freq:'',check:'',fail:''}]})});
 return {items:result.data.items,degraded:result.degraded,notice:'以下是拟实施的计划建议，需核对后保存，不是已开展培训的事实记录。'};
}
module.exports={getGroups,stats,save,applyToSections,applyToElements,declarationWarnings,trainingDraft};
