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
 }
 return null;
}
async function generate(group,context={},options={}){
 const live=llm.isLive(),plan=planFor(group.item,group.rows.length,context),size=live?3:Math.max(1,group.rows.length),blocks=[];
 let degraded=false;
 const parts=Math.ceil(group.rows.length/size);
 for(let index=0;index<parts;index++){
  const partial={...group,rows:group.rows.slice(index*size,(index+1)*size)};
  options.onPart?.({index:index+1,total:parts});
  const schema=forScore(SCHEMAS.sections,group.scoreId);
  const result=await llm.runUnit({name:'M14 正文',...PROMPTS.sections(partial,{...context,writingPlan:plan,chapterOutline:group.rows.map(r=>({elementId:r.elementId,name:r.name})),part:{index:index+1,total:parts}}),schema,maxTokens:8192,
   prepare:data=>normalizeSections(data,partial.rows.map(r=>r.elementId)),normalize:options.normalize,
   validateData:data=>validateGroup(data,partial,'blocks')||(live?validateDepth(data.items[0],partial,plan):null),
   fallback:async({reason}={})=>{if(live)throw Error('本章正文未生成完整：'+(reason||'模型暂时不可用')+'；请重试本章');return {items:[require('./baseline').sections(partial)]};}});
  for(const section of result.data.items||[])blocks.push(...section.blocks);degraded=degraded||!!result.degraded;
 }
 const section={scoreId:group.scoreId,title:group.item,blocks,writingPlan:plan};
 const error=validateGroup({items:[section]},group,'blocks')||(live?validateDepth(section,group,plan):null);if(error)throw Error(error);
 return {data:{items:[section]},degraded};
}
module.exports={generate,validateDepth,planFor};
