'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {planFor,validateDepth,generate}=require('../src/pipeline/chapter-content'),llm=require('../src/lib/llm');
const group={scoreId:'S1',item:'主要施工方案',rows:Array.from({length:5},(_,i)=>({elementId:'E'+(i+1),name:['施工准备','安装工艺','质量控制','安全管理','交接验收'][i],approach:'依据项目实际实施',params:'按招标要求',owner:'技术负责人',frequency:'按施工节点'}))};
const paragraphs=r=>[{type:'h4',text:r.name,covers:[r.elementId]},...['准备核验','实施步骤','专业接口','质量检查','异常处置','成果交付'].map(label=>({type:'p',text:r.name+label+'：'+('作业前由技术负责人组织班组核对图纸与工作界面，检查材料状态与施工条件，对不具备条件的工作面形成问题清单并落实责任岗位，确认整改复核后方可转入作业。').repeat(4),covers:[r.elementId]}))];
const readGroup=spec=>JSON.parse(spec.user.split('要素表：\n')[1].split('\n已核对')[0]);
test('章节按性质设置深化预算，明确页数上限时压缩，前后端共用同一口径',()=>{
 const detailed=planFor('主要施工方案',5),overview=planFor('工程概况',5),normal=planFor('施工部署',5);
 assert.deepEqual([detailed.low,detailed.high],[9000,13000]);assert.ok(overview.high<normal.high);assert.ok(normal.high<detailed.high);
 const limited=planFor('主要施工方案',5,{project:{pageLimit:'技术标不超过20页'},totalElements:50});assert.equal(limited.constrained,true);assert.ok(limited.high<detailed.low);assert.ok(limited.minPerElement<detailed.minPerElement);
});
test('短段落、只列标题、重复粘贴或同一段泛泛覆盖全部要素不能冒充充分展开',()=>{
 const plan=planFor(group.item,group.rows.length);
 for(const blocks of [[{type:'p',text:'按要求实施检查。',covers:group.rows.map(r=>r.elementId)}],group.rows.map(r=>({type:'h4',text:r.name,covers:[r.elementId]})),Array(20).fill({type:'p',text:'由技术负责人按工序检查并落实整改复核与交接手续。',covers:['E1']})])assert.match(validateDepth({blocks},group,plan),/展开不足/);
 const section={blocks:group.rows.flatMap(paragraphs)};assert.equal(validateDepth(section,group,plan),null);
});
test('详细生成逐条分批，控制输出大小，完整合并后执行有原文证据的深度复核',async()=>{
 const original=llm.runUnit,live=llm.isLive,called=[],progress=[];
 try{llm.isLive=()=>true;llm.runUnit=async spec=>{if(spec.name==='M14 深度复核'){const c=JSON.parse(spec.user),data={items:c.rubric.map(row=>({elementId:row.elementId,missing:[],evidence:row.questions.map(d=>({dimension:d.id,quote:c.section.blocks.find(b=>b.type==='p'&&b.covers.includes(row.elementId)).text.slice(0,30)}))}))};assert.equal(spec.validateData(data),null);return {data};}const part=readGroup(spec);called.push(part.rows.map(r=>r.elementId));assert.equal(spec.maxTokens,8192);const data={items:[{scoreId:part.scoreId,title:part.item,blocks:part.rows.flatMap(paragraphs)}]};spec.prepare(data);assert.equal(spec.validateData(data),null);return {data,degraded:false};};
 const result=await generate(group,{project:{scope:'四栋钢结构厂房',duration:'365日历天'}},{onPart:p=>progress.push(p)});
 assert.deepEqual(called,[['E1'],['E2'],['E3'],['E4'],['E5']]);assert.equal(progress.filter(p=>!p.phase).length,5);assert.equal(progress.at(-1).phase,'review');assert.equal(result.data.items[0].qualityReport.status,'reviewed');assert.equal(result.data.items[0].blocks.filter(b=>b.type==='h4').length,5);assert.equal(validateDepth(result.data.items[0],group,planFor(group.item,5)),null);
 }finally{llm.runUnit=original;llm.isLive=live;}
});
test('某一批次失败不返回伪完整章节，也不修改输入的要素及原始资料',async()=>{
 const original=llm.runUnit,live=llm.isLive,before=JSON.stringify(group);let calls=0;
 try{llm.isLive=()=>true;llm.runUnit=async spec=>{if(++calls===2)throw Error('第二部分模型不可用');const part=readGroup(spec);return {data:{items:[{scoreId:part.scoreId,blocks:part.rows.flatMap(paragraphs)}]}};};await assert.rejects(generate(group),/第二部分模型不可用/);assert.equal(calls,2);assert.equal(JSON.stringify(group),before);
 }finally{llm.runUnit=original;llm.isLive=live;}
});
test('输出预算传给模型，达到长度上限的结果即使是合法JSON也不能作为完整正文',async()=>{
 const config=require('../src/config'),originalFetch=global.fetch,live=config.llm.live;let sent;
 try{config.llm.live=true;global.fetch=async(url,o)=>{sent=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]})};};
 const spec={name:'输出完整性验证',system:'s',user:'u',schema:{type:'object',required:['ok']},maxTokens:8192,maxRetries:0,fallback:async({reason})=>{throw Error(reason);}};
 await llm.runUnit(spec);assert.equal(sent.max_tokens,8192);
 global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"ok":true}'},finish_reason:'length'}]})});await assert.rejects(llm.runUnit(spec),/长度上限/);
 }finally{global.fetch=originalFetch;config.llm.live=live;}
});
