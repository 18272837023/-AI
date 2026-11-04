'use strict';
const store=require('./lib/store'),llm=require('./lib/llm');
const {textOf}=require('./repair-targets');
const clone=x=>JSON.parse(JSON.stringify(x));
const chars=s=>textOf(s).replace(/\s/g,'').length;
const CHARS_PER_PAGE=420;
function bad(message){throw Object.assign(Error(message),{statusCode:400});}
function plan(t,targetPages){
 if(!Number.isInteger(targetPages)||targetPages<1||targetPages>300)bad('目标总页数应为 1—300 的整数');
 if(!t.sections?.length||!t.blueprint?.length)bad('请先完成正文生成');
 if(t.blueprint.some(bp=>!t.sections.some(s=>String(s.scoreId)===String(bp.scoreId)&&s.blocks?.some(b=>b.type==='p'&&b.text?.trim()||b.type==='table'&&b.rows?.slice(1).some(r=>r.some(c=>String(c).trim()))))))bad('请先补齐所有章节再扩写全稿');
 const limit=String(t.parse?.project?.pageLimit||'').replace(/\s/g,'').match(/(\d+)\s*页|^(\d+)$/);
 if(limit&&targetPages>Number(limit[1]||limit[2]))bad('目标页数超过招标文件规定的 '+Number(limit[1]||limit[2])+' 页上限');
 const totalScore=t.blueprint.reduce((n,bp)=>n+(bp.score>0?bp.score:0),0);if(!totalScore)bad('缺少技术分值，请先确认评分项');
 const rows=t.sections.map(s=>{const bp=t.blueprint.find(b=>String(b.scoreId)===String(s.scoreId)),score=Math.max(0,bp?.score||0),words=chars(s),targetWords=Math.round(targetPages*CHARS_PER_PAGE*score/totalScore);return {scoreId:s.scoreId,title:s.title,score,currentWords:words,targetWords,addWords:score?Math.max(0,targetWords-words):0,targetPages:Math.round(targetWords/CHARS_PER_PAGE*10)/10};});
 return {targetPages,charsPerPage:CHARS_PER_PAGE,totalScore,currentWords:rows.reduce((n,r)=>n+r.currentWords,0),addWords:rows.reduce((n,r)=>n+r.addWords,0),rows};
}
async function run(jobId,t){
 const target=plan(t,store.getJob(jobId).options.targetPages),revision=t.revision||0;
 if(!target.addWords)throw Error('现有篇幅已达到目标，请提高目标总页数');
 const sections=clone(t.sections),failed=[],rows=target.rows.filter(r=>r.addWords>0);
 store.updateJob(jobId,{total:rows.length+1,step:0,items:rows.map(r=>({...r,status:'queued'})),label:'按技术分值分配扩写篇幅'});
 for(let i=0;i<rows.length;i++){
  const row=rows[i],section=sections.find(s=>s.scoreId===row.scoreId),group=t.elements?.find(g=>g.scoreId===row.scoreId);
  store.updateJob(jobId,{step:i,label:'扩写：'+row.title,items:store.getJob(jobId).items.map((r,n)=>n===i?{...r,status:'running'}:r)});
  try{
   if(!group?.rows?.length)throw Error('缺少对应要素表，请先补齐');
   const additions=[],rounds=Math.max(1,Math.ceil(row.addWords/(group.rows.length*750)));
   for(let round=0;round<rounds;round++){
    const per=Math.ceil(row.addWords/rounds/group.rows.length),writingPlan={perElementLow:per,perElementHigh:Math.ceil(per*1.15),minPerElement:Math.floor(per*.8),minBlocks:per>=300?2:1};
    const result=await require('./pipeline/chapter-content').generate(group,{project:t.parse?.project,qualifications:t.parse?.qualifications,writingPlan,expansion:{round:round+1,total:rounds,instruction:'只编写新增的深入论述，服务端会保留原文并追加。根据原文尚未充分展开之处补充具体工作步骤、专业接口、交付验收、异常闭环与本项目边界，不重复已有段落或原表。真实事实不得猜填。',existing:textOf({...section,blocks:[...section.blocks,...additions]}).slice(-18000)},source:require('./pipeline/units').docBlock(require('./pipeline/units').pickSections(t.doc?.sections||[],[row.title,'技术要求','采购需求'],{max:10}),18000)},{onPart:p=>store.updateJob(jobId,{label:`扩写：${row.title} · 第 ${round+1}/${rounds} 轮，第 ${p.index}/${p.total} 部分`})});
    const existing=new Set([...section.blocks,...additions].map(b=>b.type==='table'?JSON.stringify(b.rows):b.text?.replace(/\s/g,'')));
    for(const b of result.data.items[0].blocks){if(b.type==='h4'){additions.push({...b,text:b.text+'（补充措施）'});continue;}const key=b.type==='table'?JSON.stringify(b.rows):b.text?.replace(/\s/g,'');if(!existing.has(key)){additions.push(b);existing.add(key);}}
   }
   const next={...section,blocks:[...section.blocks,...additions]};
   if(llm.isLive()&&chars(next)-row.currentWords<row.addWords*.75)throw Error('新增内容不足目标篇幅，原章已保留，请重试扩写');
   next.plain=textOf(next);next.wordCount=chars(next);Object.assign(section,next);
   store.updateJob(jobId,{items:store.getJob(jobId).items.map((r,n)=>n===i?{...r,status:'done',wordCount:next.wordCount}:r)});
  }catch(e){failed.push({scoreId:row.scoreId,title:row.title,error:e.message});store.updateJob(jobId,{items:store.getJob(jobId).items.map((r,n)=>n===i?{...r,status:'failed',error:e.message}:r)});}
  store.updateJob(jobId,{step:i+1});
 }
 if(failed.length===rows.length)throw Error('扩写未完成，原稿已保留：'+failed.map(f=>f.title+'：'+f.error).join('；'));
 if(t.revision!==revision)throw Error('正文已经变化，本次扩写没有覆盖新内容，请重试');
 const check=require('./rules/check').checkAll({...t,sections});
 const history=[...(t.documentHistory||[]),{at:new Date().toISOString(),reason:'expand',sections:clone(t.sections)}].slice(-5);
 store.updateTender(t.id,{sections,check,documentHistory:history});store.flush();
 return {targetPages:target.targetPages,estimatedPages:Math.ceil(sections.reduce((n,s)=>n+chars(s),0)/CHARS_PER_PAGE),changed:rows.length-failed.length,failed};
}
module.exports={plan,run};
