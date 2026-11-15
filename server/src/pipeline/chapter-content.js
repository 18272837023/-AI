'use strict';
const llm=require('../lib/llm');
const {PROMPTS,SCHEMAS,forScore}=require('./units');
const {normalizeSections}=require('./normalize-sections');
const {validateGroup}=require('./validation');
const {planFor}=require('../../../miniprogram/utils/writing-profile');
function substantive(block){return block.type==='p'?String(block.text||''):block.type==='table'?(block.rows||[]).slice(1).map(r=>r.join('；')).join('\n'):'';}
function validateDepth(section,group,plan){
 for(const row of group.rows||[]){
  const seen=new Set();let chars=0,blocks=0;
  for(const block of section.blocks||[]){if(!block.covers?.includes(row.elementId))continue;const text=substantive(block).replace(/\s/g,'');if(text.length<Math.min(20,plan.minPerElement)||seen.has(text))continue;seen.add(text);chars+=text.length/Math.max(1,block.covers.length);blocks++;}
  if(chars<plan.minPerElement||blocks<plan.minBlocks)return `「${row.name||row.elementId}」展开不足：需要至少${plan.minBlocks}段有实质内容的做法/控制说明、约${plan.minPerElement}字以上，补写实施步骤、项目针对性、责任频次、检查验收及异常处置，不能用一个短段落或重复文字代替`;
  if(plan.constrained&&chars>plan.perElementHigh*1.05)return `「${row.name||row.elementId}」超出本章页数预算，请压缩重复表述并控制在每条约${plan.perElementHigh}字以内，保留实质措施与交付要求`;
 }
 return null;
}
async function generate(group,context={},options={}){
 const quality=require('./writing-quality'),live=llm.isLive(),plan=context.writingPlan||planFor(group.item,group.rows.length,context),size=live?Math.max(1,Math.min(3,Math.floor(2100/Math.max(1,plan.perElementHigh)))):Math.max(1,group.rows.length),blocks=[];
 if(plan.perElementHigh<12)throw Error('当前页数上限不足以展开全部要素，请核对招标页数限制和大纲，不能用空段落冒充完整正文');
 const {otherSections=[],...writerContext}=context;
 let degraded=false;
 const chunks=live&&plan.perElementHigh>2800?group.rows.flatMap(row=>{const n=Math.ceil(plan.perElementHigh/2400);return Array.from({length:n},(_,i)=>({rows:[row],segment:{index:i+1,total:n},plan:{...plan,perElementLow:Math.ceil(plan.perElementLow/n),perElementHigh:Math.ceil(plan.perElementHigh/n),minPerElement:Math.floor(plan.minPerElement/n),minBlocks:Math.max(1,Math.ceil(plan.minBlocks/n))}}));}):Array.from({length:Math.ceil(group.rows.length/size)},(_,i)=>({rows:group.rows.slice(i*size,(i+1)*size),plan}));
 const parts=chunks.length;
 for(let index=0;index<parts;index++){
  const chunk=chunks[index],partial={...group,rows:chunk.rows},partPlan=chunk.plan;
  options.onPart?.({index:index+1,total:parts});
  const schema=forScore(SCHEMAS.sections,group.scoreId);
  const result=await llm.runUnit({name:'M14 正文',...PROMPTS.sections(partial,{...writerContext,writingPlan:partPlan,writingAssignments:quality.assignments(partial,context,plan),chapterOutline:group.rows.map(r=>({elementId:r.elementId,name:r.name})),previousDraft:require('../repair-targets').textOf({blocks}).slice(-6000),avoidRepeating:otherSections.map(s=>({title:s.title,text:require('../repair-targets').textOf(s).slice(0,1200)})).slice(-5),part:{index:index+1,total:parts},elementSegment:chunk.segment}),schema,maxTokens:8192,timeoutMs:Math.max(require('../config').llm.timeoutMs,240000),
   prepare:data=>normalizeSections(data,partial.rows.map(r=>r.elementId)),normalize:options.normalize,
   validateData:data=>validateGroup(data,partial,'blocks')||(live?validateDepth(data.items[0],partial,partPlan)||quality.validateGrounding(data.items[0],context):null)||(live&&quality.repeated(data.items[0],[...otherSections,{blocks}]).length?'存在与已写正文相同的长段落，请针对当前要素独立展开，不能复制通用段落':null),
   fallback:async({reason}={})=>{if(live)throw Error('本章正文未生成完整：'+(reason||'模型暂时不可用')+'；请重试本章');return {items:[require('./baseline').sections(partial)]};}});
  for(const section of result.data.items||[])blocks.push(...section.blocks);degraded=degraded||!!result.degraded;
 }
 const section={scoreId:group.scoreId,title:group.item,blocks,writingPlan:plan};
 const error=validateGroup({items:[section]},group,'blocks')||(live?validateDepth(section,group,plan):null);if(error)throw Error(error);
 // 复核与补写属于辅助质量控制，不把模型的主观评语变成新的流程阻断。
 if(live&&plan.version>=3&&!context.expansion){
  options.onPart?.({index:parts,total:parts,phase:'review',label:'正在逐项复核内容深度'});
  try{
   let report=await quality.review(section,group,context,plan);const revised=[],repairErrors=[];
   for(const finding of report.rows.filter(r=>r.missing.length)){
    const row=group.rows.find(r=>r.elementId===finding.elementId),partial={...group,rows:[row]},original=section.blocks.filter(b=>b.covers?.includes(row.elementId));
    // 共享段落可能同时保护其他要素，不能为单条修订删掉别人的正文。
    if(original.some(b=>b.covers.length>1)||plan.perElementHigh<400||plan.perElementHigh>2800)continue;
    options.onPart?.({index:parts,total:parts,phase:'deepen',label:'正在补强：'+row.name});
    try{
     const result=await llm.runUnit({name:'M14 定向深化',...PROMPTS.sections(partial,{...writerContext,writingPlan:plan,writingAssignments:quality.assignments(partial,context,plan),revisionTask:{instruction:'仅返回当前要素的完整深化版本，服务端替换本条草稿。解决 missing 中的问题，保留原有真实事实和待确认事实标记；不新增虚构参数，不挪用其他章节。',missing:finding.missing,original}}),schema:forScore(SCHEMAS.sections,group.scoreId),maxTokens:8192,timeoutMs:Math.max(require('../config').llm.timeoutMs,240000),maxRetries:1,prepare:data=>normalizeSections(data,[row.elementId]),validateData:data=>{
      const error=validateGroup(data,partial,'blocks')||validateDepth(data.items[0],partial,plan)||quality.validateGrounding(data.items[0],context);if(error)return error;
      const {MARKER,needsUser,isPlanHedge}=require('../facts'),text=require('../repair-targets').textOf(data.items[0]);for(const match of require('../repair-targets').textOf({blocks:original}).matchAll(new RegExp(MARKER.source,'g')))if(needsUser(match[1])&&!isPlanHedge(match[1])&&!text.includes(match[0]))return '不得删除或猜填原草稿中的真实事实占位符';
      return quality.repeated(data.items[0],[...otherSections,{blocks:section.blocks.filter(b=>!b.covers?.includes(row.elementId))}]).length?'不得复制其他要素或章节的段落':null;
     },fallback:async({reason}={})=>{throw Error(reason||'定向深化未完成');}});
     const index=section.blocks.findIndex(b=>b.covers?.includes(row.elementId));section.blocks=section.blocks.filter(b=>!b.covers?.includes(row.elementId));section.blocks.splice(index,0,...result.data.items[0].blocks);revised.push(row.elementId);
    }catch(e){repairErrors.push({elementId:row.elementId,error:e.message});}
   }
   if(revised.length){options.onPart?.({index:parts,total:parts,phase:'review',label:'正在复核深化后的内容'});report=await quality.review(section,group,context,plan);}
   section.qualityReport={...report,revised,repairErrors};
  }catch(e){section.qualityReport={version:1,status:'unverified',reason:e.message,rows:[],basis:'辅助复核未完成，请人工核对内容深度'};}
 }
 if(section.qualityReport)section.qualityReport.fingerprint=quality.fingerprint(section);
 return {data:{items:[section]},degraded};
}
module.exports={generate,validateDepth,planFor};
