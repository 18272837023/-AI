'use strict';
const content=require('./pipeline/chapter-content');
const {validateGroup}=require('./pipeline/validation');
const {textOf}=require('./repair-targets');
const clone=x=>JSON.parse(JSON.stringify(x));
const key=b=>(b.type==='table'?JSON.stringify(b.rows):String(b.text||'')).replace(/\s/g,'');
const chars=blocks=>blocks.reduce((n,b)=>n+(b.type==='p'?String(b.text||''):b.type==='table'?(b.rows||[]).slice(1).map(r=>r.join('')).join(''):'').replace(/\s/g,'').length,0);

// 扩写只生成新增段落，避免长章原文占满单次输出预算；整章完成后才由 writing 原子保存。
async function expand(section,group,context={},options={}){
 if(!group.rows?.length)throw Error('本章缺少必答要素，请先确认大纲');
 const original=clone(section),originalWords=textOf(original).replace(/\s/g,'').length;
 const target=Math.max(600,Math.ceil(originalWords*.2),group.rows.length*300);
 const rounds=Math.max(1,Math.ceil(target/(group.rows.length*600)));
 const per=Math.ceil(target/rounds/group.rows.length);
 const writingPlan={perElementLow:per,perElementHigh:Math.ceil(per*1.3),minPerElement:Math.floor(per*.8),minBlocks:per>=300?2:1};
 const additions=[],seen=new Set(original.blocks.map(key));
 for(let round=0;round<rounds;round++){
  const result=await content.generate(group,{...context,writingPlan,expansion:{round:round+1,total:rounds,instruction:'只生成尚未充分展开的新增论述，不得返回、压缩或重写原文。原文由服务端完整保留。结合本章要素补充项目针对性的工作步骤、专业接口、检查验收、异常处置和记录闭环；不重复已有段落或表格，不猜填真实事实。',existing:textOf({...original,blocks:[...original.blocks,...additions]}).slice(-18000)}},{onPart:part=>options.onPart?.({...part,round:round+1,rounds})});
  const generated=result.data.items[0],error=validateGroup({items:[generated]},group,'blocks');if(error)throw Error(error);
  for(const source of generated.blocks){
   const block=source.type==='h4'?{...source,text:source.text+'（补充措施）'}:source;
   const id=key(block);if(!id||seen.has(id))continue;seen.add(id);
   additions.push(clone(block));
  }
 }
 const minimum=Math.max(Math.ceil(originalWords*.15),Math.floor(target*.75));
 if(chars(additions)<minimum)throw Error('新增的有效内容不足，可能与原文重复；本章原文已保留，请重试');
 const addedSection={...original,blocks:additions},error=validateGroup({items:[addedSection]},group,'blocks')||(require('./lib/llm').isLive()?content.validateDepth(addedSection,group,writingPlan):null);if(error)throw Error(error);
 return {...original,blocks:[...original.blocks,...additions]};
}
module.exports={expand};
