'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'chapter-expansion-'));
process.env.DATA_DIR=tmp;process.env.UPLOAD_DIR=path.join(tmp,'uploads');process.env.STORE_DRIVER='local';process.env.LLM_MODE='mock';
const store=require('../src/lib/store'),llm=require('../src/lib/llm'),config=require('../src/config'),writing=require('../src/writing');
after(()=>{store.flush();fs.rmSync(tmp,{recursive:true,force:true});});
function fixture(){
 const t=store.createTender({name:'长章节扩写测试'}),elements=Array.from({length:5},(_,i)=>({id:'E'+(i+1),name:['工程管理服务','造价咨询服务','招标代理服务','接口协同','验收交付'][i]}));
 const group={scoreId:'S1',item:'分项专项服务方案',rows:elements.map(e=>({elementId:e.id,name:e.name,approach:'结合采购需求拟定服务步骤',params:'按采购要求执行',owner:'项目负责人',frequency:'按任务节点'}))};
 const section=writing.recalc({scoreId:'S1',title:group.item,blocks:[{type:'p',text:'用户精修原文。'+('项目服务原文应完整保留。').repeat(532),covers:elements.map(e=>e.id)},{type:'p',text:'〔待确认：现场临时用电容量〕',covers:['E1'],supplementGroupId:'F3'}]});
 store.updateTender(t.id,{parse:{project:{},scores:[{id:'S1',item:group.item,score:6}],qualifications:[],outline:{}},blueprint:[{scoreId:'S1',item:group.item,score:6,elements}],elements:[group],sections:[section,{scoreId:'manual',title:'人工章节',blocks:[{type:'p',text:'不要改动其他章节',covers:[]}]}]});
 const job=store.createJob(t.id,'chapter',3);store.updateJob(job.id,{options:{scoreId:'S1',action:'expand'}});return {t,group,job};
}
const readGroup=user=>JSON.parse(user.split('要素表：\n')[1].split('\n已核对')[0]);
const paragraphs=row=>[{type:'h4',text:row.name,covers:[row.elementId]},...['执行步骤','检查闭环'].map(label=>({type:'p',text:row.name+label+'：'+('项目负责人组织专业人员核对任务边界和成果要求，形成责任清单，按节点检查交付成果与接口条件，对发现的问题指定责任岗位整改，完成复核并留存记录后办理交接。').repeat(3),covers:[row.elementId]}))];
test('六千余字章节分批只生成增量，完整保护原文、事实和其他章节，保存后刷新字数与自检',async()=>{
 const {t,job}=fixture(),before=JSON.parse(JSON.stringify(t.sections)),originalFetch=global.fetch,live=config.llm.live;const batches=[];
 try{config.llm.live=true;global.fetch=async(url,options)=>{const request=JSON.parse(options.body),user=request.messages[1].content,group=readGroup(user),context=JSON.parse(user.split('已核对的项目信息与响应要求（需在相关段落写明条款号）：\n')[1]);batches.push(group.rows.map(r=>r.elementId));assert.ok(group.rows.length<=3);assert.ok(context.writingPlan.perElementHigh<=780);assert.match(user,/只生成尚未充分展开的新增论述/);assert.match(context.expansion.existing,/用户精修原文/);assert.equal(request.max_tokens,8192);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{scoreId:group.scoreId,title:group.item,blocks:group.rows.flatMap(paragraphs)}]})}}]})};};
 assert.ok(before[0].wordCount>6000);const result=await writing.run(job.id,t,'chapter');assert.deepEqual(batches,[['E1','E2','E3'],['E4','E5']]);assert.equal(result.changed,1);assert.deepEqual(t.sections[0].blocks.slice(0,before[0].blocks.length),before[0].blocks);assert.deepEqual(t.sections[1],before[1]);assert.ok(t.sections[0].wordCount>before[0].wordCount*1.15);assert.ok(t.check);assert.deepEqual(t.documentHistory.at(-1).sections,before);assert.match(store.getJob(job.id).label,/自检/);
 }finally{global.fetch=originalFetch;config.llm.live=live;}
});
test('第二批失败不保存第一批半成品，错误保留具体原因，原文与版本完全不变',async()=>{
 const {t,job}=fixture(),before=JSON.stringify(t),run=llm.runUnit,isLive=llm.isLive;let count=0;
 try{llm.isLive=()=>true;llm.runUnit=async spec=>{if(++count===2)throw Error('模型输出达到长度上限，当前内容未完整生成');const group=readGroup(spec.user);return {data:{items:[{scoreId:group.scoreId,title:group.item,blocks:group.rows.flatMap(paragraphs)}]}};};await assert.rejects(writing.run(job.id,t,'chapter'),/长度上限/);assert.equal(count,2);assert.equal(JSON.stringify(t),before);assert.equal(t.documentHistory,undefined);
 }finally{llm.runUnit=run;llm.isLive=isLive;}
});
test('只重复原文或只补充标题不能冒充扩写成功',async()=>{
 const {t,group}=fixture(),generator=require('../src/pipeline/chapter-content'),original=generator.generate,before=JSON.stringify(t.sections);
 try{generator.generate=async()=>({data:{items:[{scoreId:group.scoreId,title:group.item,blocks:[...group.rows.map(r=>({type:'h4',text:r.name,covers:[r.elementId]})),{...t.sections[0].blocks[0]}]}]}});await assert.rejects(require('../src/chapter-expansion').expand(t.sections[0],group),/有效内容不足/);assert.equal(JSON.stringify(t.sections),before);
 }finally{generator.generate=original;}
});
test('生成期间正文被人工更新时不覆盖新版本，也不保存过期扩写结果',async()=>{
 const {t,job}=fixture(),generator=require('../src/pipeline/chapter-content'),original=generator.generate;
 try{generator.generate=async group=>{store.updateTender(t.id,{name:'用户修改后的项目'});return {data:{items:[{scoreId:group.scoreId,title:group.item,blocks:group.rows.flatMap(paragraphs)}]}};};const before=JSON.stringify(t.sections);await assert.rejects(writing.run(job.id,t,'chapter'),/正文已经变化/);assert.equal(JSON.stringify(t.sections),before);assert.equal(t.name,'用户修改后的项目');
 }finally{generator.generate=original;}
});
test('其他章节修改失败透出真实校验原因，不再吞成统一的重试提示',async()=>{
 const {t,job}=fixture(),original=llm.runUnit;store.updateJob(job.id,{options:{scoreId:'S1',action:'polish'}});
 try{llm.runUnit=async spec=>spec.fallback({reason:'模型接口 429：请求过于频繁'});await assert.rejects(writing.run(job.id,t,'chapter'),/429.*请求过于频繁/);
 }finally{llm.runUnit=original;}
});
test('更长章节自动分轮，不通过扩大单次输出预算来处理已有长文',async()=>{
 const {t,group}=fixture(),section={...t.sections[0],blocks:[{type:'p',text:'完整原稿。'.repeat(6000),covers:group.rows.map(r=>r.elementId)}]},generator=require('../src/pipeline/chapter-content'),original=generator.generate,steps=[];
 try{generator.generate=async(part,context,options)=>{steps.push(context.expansion.round);assert.ok(context.writingPlan.perElementHigh<=780);options.onPart({index:1,total:1});return {data:{items:[{scoreId:part.scoreId,title:part.item,blocks:part.rows.flatMap(row=>paragraphs({...row,name:row.name+'第'+context.expansion.round+'轮'}))}]}};};const result=await require('../src/chapter-expansion').expand(section,group);assert.ok(steps.length>1);assert.deepEqual(steps,Array.from({length:steps.length},(_,i)=>i+1));assert.deepEqual(result.blocks[0],section.blocks[0]);assert.ok(result.blocks.length>section.blocks.length);
 }finally{generator.generate=original;}
});
