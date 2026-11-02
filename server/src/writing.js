'use strict';
const store=require('./lib/store');
const llm=require('./lib/llm');
const checks=require('./rules/check');
const {SCHEMAS,PROMPTS,docBlock,pickSections}=require('./pipeline/units');
const {validateGroup}=require('./pipeline/validation');
const {MARKER,needsUser,isPlanHedge}=require('./facts');
const {planRepair,putSection,textOf,same}=require('./repair-targets');
const {normalizeSections}=require('./pipeline/normalize-sections');
const copy=x=>JSON.parse(JSON.stringify(x));
const recalc=s=>{s.plain=textOf(s);s.wordCount=s.plain.replace(/\s/g,'').length;return s;};
async function prepareGroup(t,sec,stagedElements){
 const bp=(t.blueprint||[]).find(b=>same(b.scoreId,sec.scoreId));
 const existing=stagedElements.find(g=>same(g.scoreId,sec.scoreId));
 if(!bp?.elements?.length){if(existing?.rows?.length)return existing;throw Error(`「${sec.title}」缺少必答要素定义，请先重新确认施工图`);}
 const missing=bp.elements.filter(e=>!existing?.rows?.some(r=>r.elementId===e.id));
 if(!missing.length)return existing;
 const result=await llm.runUnit({name:'修复前补齐要素表',...PROMPTS.elementTable(bp,{project:t.parse?.project,qualifications:t.parse?.qualifications,confirmedRows:existing?.rows||[],source:docBlock(pickSections(t.doc?.sections||[],[sec.title,'技术要求','招标范围'],{max:10}),18000)}),schema:require('./pipeline/units').forScore(SCHEMAS.elementTable,bp.scoreId),validateData:data=>validateGroup(data,bp,'rows'),fallback:async()=>{throw Error(`「${sec.title}」要素表尚未补齐，请重试本章 AI 优化`);}});
 const rows=bp.elements.map(e=>existing?.rows?.find(r=>r.elementId===e.id)||result.data.items[0].rows.find(r=>r.elementId===e.id));
 const group={...existing,scoreId:bp.scoreId,item:bp.item,rows};
 const index=stagedElements.findIndex(g=>same(g.scoreId,bp.scoreId));if(index<0)stagedElements.push(group);else stagedElements[index]=group;
 return group;
}
async function run(jobId,t,stage){
 const job=store.getJob(jobId),options=job.options||{},revision=t.revision||0;
 const current=checks.checkAll(t),issues=current.items.filter(i=>i.level!=='pass'&&i.fixType==='auto'&&(!options.issueId||i.id===options.issueId));
 if(stage==='repair'&&!issues.length)throw Error('当前没有可由 AI 修复的问题；真实资料请在待补字段填写');
 const all=copy(t.sections||[]);
 const plan=stage==='chapter'?{targets:all.filter(s=>same(s.scoreId,options.scoreId)),created:new Set()}:planRepair({...t,sections:all},issues);
 const affected=plan.targets;
 if(!affected.length)throw Error(stage==='chapter'?'所选章节已变化，请重新打开章节后再试':'当前问题无法关联到施工图，请重新自检并核对解析与施工图');
 // total 多算两步（读取问题 / 重算自检），否则单章修复一上来就是 99%，看起来像卡住
 store.updateJob(jobId,{total:affected.length+2,step:1,label:'读取自检问题',items:affected.map(s=>({scoreId:s.scoreId,title:s.title,status:'queued',action:plan.created.has(String(s.scoreId))?'create':'update'}))});
 const operation=stage==='repair'?'按自检问题局部修复，保留其他文字和用户提供的事实':({continue:'续写本章尚未展开的内容，保留已有正文',expand:'扩写：保留原有结论与已确认事实，补充具体实施方法、工序衔接、控制要点、检查动作和量化指标，正文必须比原文明显更充实，不得原样返回原文',polish:'润色为清晰、具体的技术标语言，保留原意和已确认事实',chart:'保留原文，并新增与本章内容相符的实施计划表或检查流程表。table 类型块必须有矩形 rows 数组，第一行为表头。不得编造测量数据'})[options.action];
 if(!operation)throw Error('不支持的章节操作');
 const failed=[];
 const stagedElements=copy(t.elements||[]);
 let elementsChanged=false;
 for(let i=0;i<affected.length;i++){
  const sec=recalc(copy(affected[i]));
  let group;
  const items=store.getJob(jobId).items.map((r,n)=>n===i?{...r,status:'running'}:r);
  store.updateJob(jobId,{step:i+2,label:`${plan.created.has(String(sec.scoreId))?'补写缺失章节':operation.slice(0,8)}：${sec.title}`,items});
  let result;
  try{
  const preparedElements=copy(stagedElements);
  group=await prepareGroup(t,sec,preparedElements);
  const writingPlan=require('./pipeline/chapter-content').planFor(group.item,group.rows.length,{project:t.parse?.project,totalElements:(t.blueprint||[]).reduce((n,bp)=>n+bp.elements.length,0)});
  const deepen=options.action==='expand'||plan.created.has(String(sec.scoreId));
  const depthRules=deepen?[`按要素分节，每条目标约${writingPlan.perElementLow}—${writingPlan.perElementHigh}字，至少${writingPlan.minBlocks}个实质段落，说明项目针对性、实施步骤、关键控制、责任频次、检查验收和整改复核。概况类按已知事实、范围边界和实施约束展开，不虚构工程事实。`,writingPlan.constrained?'已根据技术标页数预算压缩篇幅，优先增加信息密度。':'不以重复原文、堆通用口号或空表增加字数。']:[];
  result=await llm.runUnit({name:'章节 AI '+(options.action||'修复'),system:PROMPTS.sections(group).system,schema:require('./pipeline/units').forScore(SCHEMAS.sections,sec.scoreId),maxRetries:2,maxTokens:8192,prepare:data=>normalizeSections(data,group.rows.map(r=>r.elementId)),
   user:JSON.stringify({task:operation,issues,writingPlan,depthRules,project:t.parse?.project,requirements:t.parse?.qualifications?.filter(q=>q.resp==='tech'),source:docBlock(pickSections(t.doc?.sections||[],[sec.title,'技术要求','建设规模','招标范围'],{max:10}),18000),elementTable:group,original:{...sec,blocks:sec.blocks.filter(b=>!b.supplementGroupId)},supplements:require('./supplements').getGroups(t).map(g=>({name:g.name,declared:g.declared,entries:g.entries})),rules:['只返回当前scoreId的完整章节，不得新增其他评分项。已确认的补充事实由服务端保护并织入，请勿重复输出独立的补充资料块。','真实业绩、人员入场时间、现场实测容量不得猜填，相关已有待确认标记原样保留。','其余待确认如果是计划、流程、责任、频次、图表、编写统计，或拟投入的人员机械配置、设备清单、供应商与入场计划、现场移交界面这类投标人可自行拟定的内容，由你写成完整可执行方案，不要向用户提问。','合格性缺失需写出实质响应及原条款编号，不能只插编号。','所有原本已覆盖的要素仍须有实际正文回应。图表若用table必须写text为标题，rows为2—12行、2—6列字符串。']}),
   validateData:data=>{const err=validateGroup(data,group,'blocks');if(err)return err;const next=data.items[0];if(deepen&&llm.isLive()){const depthError=require('./pipeline/chapter-content').validateDepth(next,group,writingPlan);if(depthError)return depthError;}const plain=textOf(next);const facts=[...sec.plain.matchAll(new RegExp(MARKER.source,'g'))].filter(m=>needsUser(m[1])&&!isPlanHedge(m[1]));if(facts.some(m=>!plain.includes(m[0])))return '不得猜填或删除需要用户提供的真实事实占位符';
    // 与 rules/check.js 的 C5-A 口径保持一致：除用户事实外，占位符必须清零，
    // 否则修复完仍会被自检判为阻断，用户看到「优化了但数字没变」。
    const residual=[...plain.matchAll(new RegExp(MARKER.source,'g'))].filter(m=>!needsUser(m[1].trim())||isPlanHedge(m[1].trim()));
    if(residual.length)return '本章仍有 '+residual.length+' 处方案内容停留在待确认（'+residual.slice(0,3).map(m=>m[1].trim()).join('、')+'），这些属于应由你写实的方案内容，必须直接写成具体做法、频次或岗位';
    if(options.action==='expand'&&plain.replace(/\s/g,'').length<sec.plain.replace(/\s/g,'').length*1.15)return '扩写后的正文没有实质增加，请补充具体方法、步骤、控制要点与量化指标后再返回';if(options.action==='chart'&&!next.blocks.some(b=>b.type==='table'))return '配图表必须生成真实表格';for(const b of next.blocks.filter(b=>b.type==='table'))if(!b.rows?.length||b.rows.some(r=>r.length!==b.rows[0].length))return '表格列数不一致';return null;},
   fallback:async()=>{throw Error('AI 暂未完成本次修改，原文已保留，请重试');}});
  }catch(e){
    // 单章失败不拖垮整次优化：记录后继续修其他章节，最后由 check 如实反映剩余阻断。
    failed.push({scoreId:sec.scoreId,title:sec.title,error:e.message});
    store.updateJob(jobId,{items:store.getJob(jobId).items.map((r,n)=>n===i?{...r,status:'failed',error:e.message}:r)});
    store.pushJobLog(jobId,'error',`「${sec.title}」未修完：${e.message}`);
    store.updateJob(jobId,{step:i+2});
    // 全部章节都没修成才算整次失败，否则带着部分成果继续。
    continue;
  }
  const next=result.data.items[0];
  // 单独保护用户补充的事实块，不允许模型重写或复制它们。
  const protectedBlocks=sec.blocks.filter(b=>b.supplementGroupId);
  next.blocks=next.blocks.filter(b=>!protectedBlocks.some(p=>p.text===b.text));
  next.blocks.push(...protectedBlocks);
  putSection(all,{...sec,...recalc(next),aiEdited:true},t.blueprint);
  // 要素表与对应正文同时成功后才一起保存，失败章节不留空壳或半成品。
  if(JSON.stringify(group)!==JSON.stringify(stagedElements.find(g=>same(g.scoreId,group.scoreId)))){const index=stagedElements.findIndex(g=>same(g.scoreId,group.scoreId));if(index<0)stagedElements.push(group);else stagedElements[index]=group;elementsChanged=true;}
  store.updateJob(jobId,{step:i+2,items:store.getJob(jobId).items.map((r,n)=>n===i?{...r,status:'done'}:r)});
 }
 if(failed.length===affected.length)throw Error('本次优化没有修完任何章节：'+failed.map(f=>`「${f.title}」${f.error}`).join('；'));
 store.updateJob(jobId,{step:affected.length+2,label:'重新计算自检结果'});
 if(t.revision!==revision)throw Error('正文已经变化，本次修改未覆盖新内容，请重试');
 const check=checks.checkAll({...t,sections:all,elements:stagedElements});
 const history=[...(t.documentHistory||[]),{at:new Date().toISOString(),reason:stage,sections:copy(t.sections)}].slice(-5);
 store.updateTender(t.id,{sections:all,...(elementsChanged?{elements:stagedElements}:{}),check,documentHistory:history});store.flush();
 return {changed:affected.length-failed.length,created:affected.filter(s=>plan.created.has(String(s.scoreId))&&!failed.some(f=>same(f.scoreId,s.scoreId))).length,failed,blocking:check.blocking,warning:check.warning,remainingAuto:check.items.filter(i=>i.level!=='pass'&&i.fixType==='auto').length};
}
module.exports={run,recalc};
