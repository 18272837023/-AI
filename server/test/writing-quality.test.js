'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const profile=require('../../miniprogram/utils/writing-profile'),context=require('../src/pipeline/writing-context'),quality=require('../src/pipeline/writing-quality'),content=require('../src/pipeline/chapter-content'),llm=require('../src/lib/llm');
const group={scoreId:'T1',item:'专项服务方案',rows:[{elementId:'E1',name:'造价咨询工作方法'},{elementId:'E2',name:'成果质量检查'}]};
const labels=['项目边界','资料接收','专业实施','协作接口','成果验收','异常闭环'];
function blocks(row,tag='初稿',fact=false){return [{type:'h4',text:row.name,covers:[row.elementId]},...labels.map((label,i)=>({type:'p',covers:[row.elementId],text:row.name+tag+label+'：'+('本项目负责人会同专业工程师核对服务任务、资料版本与交付边界，接收资料时登记来源并形成缺项清单，按专业审核后交叉复核，对不一致项征求委托人确认，记录处理意见并办理成果移交。').repeat(4)+(fact&&i===0?'现场临时用电容量为〔待确认：现场临时用电容量〕。':'')}))];}
function read(spec){return JSON.parse(spec.user.split('要素表：\n')[1].split('\n已核对')[0]);}
function assessment(spec,missing={}){const c=JSON.parse(spec.user);return {items:c.rubric.map(row=>({elementId:row.elementId,missing:missing[row.elementId]||[],evidence:row.questions.filter(d=>!(missing[row.elementId]||[]).includes(d.id)).map(d=>({dimension:d.id,quote:c.section.blocks.find(b=>b.type==='p'&&b.covers.includes(row.elementId)).text.slice(0,30)}))}))};}
async function mockModel(fn,run){const old=llm.runUnit,live=llm.isLive;try{llm.isLive=()=>true;llm.runUnit=fn;return await run();}finally{llm.runUnit=old;llm.isLive=live;}}
function sectionResult(spec,tag='初稿',fact=false){const part=read(spec),data={items:[{scoreId:part.scoreId,title:part.item,blocks:part.rows.flatMap(r=>blocks(r,tag,fact))}]};spec.prepare(data);assert.equal(spec.validateData(data),null);return {data,degraded:false};}
test('篇幅规划同时考虑评分与复杂度，尊重全稿页数预算，无分值人工章节仍有内容',()=>{
 const chapters=[{scoreId:'a',item:'专项施工方案',score:20,elementCount:5},{scoreId:'b',item:'专项服务方案',score:5,elementCount:5},{scoreId:'c',item:'人工补充说明',score:0,elementCount:2}];
 const p=profile.documentPlan(chapters);assert.ok(p[0].high>p[1].high);assert.ok(p[2].high>0);assert.ok(p[0].high>=5*2600);
 const limited=profile.documentPlan(chapters,{pageLimit:'技术标最多60页'});assert.ok(limited.reduce((n,c)=>n+c.high,0)<=60*420*.85);assert.ok(limited.every(c=>c.constrained));assert.deepEqual(profile.planFor(chapters[0].item,5,{chapters,scoreId:'a',project:{pageLimit:'技术标最多60页'}}),{...limited[0],version:3});
});
test('原文检索覆盖长章节后部专业要求，证据保持原文和页码，不夹带范本事实',()=>{
 const sections=[{no:'1',title:'一般说明',page:1,text:'采购工作按要求开展。'.repeat(500)},{no:'6.2',title:'服务需求',page:32,text:'前部通用说明。'.repeat(600)+'造价咨询工作方法要求建立变更计价差异台账，成果质量检查须保留交叉复核与确认记录。'}];
 const selected=context.selectSources(sections,group);assert.match(selected.source,/变更计价差异台账/);assert.match(selected.source,/交叉复核/);assert.ok(selected.evidence.some(e=>e.page===32));for(const e of selected.evidence){const original=sections[Number(e.id.split('-')[0].slice(1))];assert.equal(e.page,original.page);assert.ok(original.text.includes(e.quote));assert.ok(e.elementIds.every(id=>['E1','E2'].includes(id)));}
 assert.ok(selected.source.length<17000);assert.equal(context.selectSources([],group).source,'');
});
test('专业写作上下文携带当前评分档次、要素要求和来源，排除商务合格性条款',()=>{
 const t={parse:{project:{scope:'专业咨询'},qualifications:[{resp:'tech',text:'提交复核记录'},{resp:'other',text:'营业执照'}],scores:[{id:'T1',score:6,tierDesc:'针对性与可行性',evidence:{page:24,quote:'工作方法完整'}}]},blueprint:[{scoreId:'T1',item:group.item,score:6,elements:[{id:'E1',mustHave:'差异台账'}]}],doc:{sections:[{title:'造价咨询',page:8,text:'变更事项须建立差异台账。'}]}};
 const c=context.chapterContext(t,group);assert.equal(c.scoreCriteria.score,6);assert.equal(c.scoreCriteria.tierDesc,'针对性与可行性');assert.equal(c.requiredElements[0].mustHave,'差异台账');assert.equal(c.qualifications.length,1);assert.equal(c.sourceEvidence[0].page,8);
});
test('进度、资源、应急和概况使用不同编写问题，不机械套同一管理模板',()=>{
 const {playbook}=require('../src/pipeline/writing-playbook');const types=['工期进度安排','资源配置计划','突发事件应急方案','工程概况'].map(name=>playbook({item:name},{name},{}).type);assert.deepEqual(types,['schedule','resources','emergency','overview']);assert.match(playbook(group,group.rows[0],{}).focus.join(''),/差异台账/);
});
test('质量复核拒绝伪造证据、标题冒充内容和重复维度',async()=>{
 const section={scoreId:'T1',title:group.item,blocks:group.rows.flatMap(r=>blocks(r))},plan=profile.planFor(group.item,2);section.blocks[0].text='这是只出现在小标题中的审查内容文字';let checked=0;
 await mockModel(async spec=>{for(const change of [d=>d.items[0].evidence[0].quote='不存在的逐字引用内容无法证明已经写了',d=>d.items[0].evidence[0].quote=section.blocks[0].text,d=>d.items[0].evidence[0].dimension=d.items[0].evidence[1].dimension]){const d=assessment(spec);change(d);assert.ok(spec.validateData(d));checked++;}const data=assessment(spec);assert.equal(spec.validateData(data),null);return {data};},()=>quality.review(section,group,{},plan));assert.equal(checked,3);
});
test('只深化被指出薄弱的要素，保留其他要素和真实事实，随后重新复核',async()=>{
 let reviews=0,repairs=0;const progress=[];
 const result=await mockModel(async spec=>{if(spec.name==='M14 深度复核'){const data=assessment(spec,++reviews===1?{E1:['exception']}:{});assert.equal(spec.validateData(data),null);return {data};}if(spec.name==='M14 定向深化'){repairs++;assert.deepEqual(read(spec).rows.map(r=>r.elementId),['E1']);assert.match(spec.user,/exception/);return sectionResult(spec,'定向深化',true);}return sectionResult(spec,'初稿',true);},()=>content.generate(group,{project:{scope:'施工图预算审核与变更计价'}},{onPart:p=>progress.push(p)}));
 const section=result.data.items[0];assert.equal(repairs,1);assert.equal(reviews,2);assert.deepEqual(section.blocks.filter(b=>b.covers.includes('E2')),blocks(group.rows[1],'初稿',true));assert.match(section.blocks.filter(b=>b.covers.includes('E1')).map(b=>b.text).join(''),/定向深化/);assert.match(section.blocks.map(b=>b.text).join(''),/〔待确认：现场临时用电容量〕/);assert.deepEqual(section.qualityReport.revised,['E1']);assert.ok(section.qualityReport.rows.every(r=>!r.missing.length));assert.ok(progress.some(p=>p.phase==='deepen'));assert.equal(section.qualityReport.fingerprint,quality.fingerprint(section));
});
test('复核不可用时保留完整初稿，只给人工提醒而不新增阻断',async()=>{
 const result=await mockModel(async spec=>{if(spec.name==='M14 深度复核')throw Error('复核超时');return sectionResult(spec);},()=>content.generate(group));const section=result.data.items[0];assert.equal(section.qualityReport.status,'unverified');assert.equal(content.validateDepth(section,group,section.writingPlan),null);const warnings=require('../src/rules/check').checkWritingQuality({sections:[section]});assert.equal(warnings.length,1);assert.equal(warnings[0].level,'warn');
});
test('定向深化不能丢失真实事实标记，失败时保留原草稿及待核对项',async()=>{
 const result=await mockModel(async spec=>{if(spec.name==='M14 深度复核')return {data:assessment(spec,{E1:['exception']})};if(spec.name==='M14 定向深化'){const part=read(spec),data={items:[{scoreId:part.scoreId,title:part.item,blocks:blocks(part.rows[0],'伪造替换',false)}]};spec.prepare(data);assert.match(spec.validateData(data),/真实事实占位符/);throw Error('不得删除真实事实占位符');}return sectionResult(spec,'初稿',true);},()=>content.generate(group));const section=result.data.items[0];assert.deepEqual(section.blocks.filter(b=>b.covers.includes('E1')),blocks(group.rows[0],'初稿',true));assert.equal(section.qualityReport.repairErrors.length,1);assert.equal(section.qualityReport.rows[0].missing[0],'exception');
});
test('当前或其他章节的相同长段落会被识别，标题不算重复正文',()=>{
 const p={type:'p',text:'专业工程师核对图纸、任务清单和资料版本，登记差异并完成复核。'.repeat(4),covers:['E1']};assert.deepEqual(quality.repeated({blocks:[p,p]}),['E1']);assert.deepEqual(quality.repeated({blocks:[p]},[{blocks:[p]}]),['E1']);assert.deepEqual(quality.repeated({blocks:[{type:'h4',text:p.text,covers:['E1']}]}),[]);
});
test('正文人工修改后辅助复核不能继续冒充当前结论，发出非阻断提醒',()=>{
 const section={scoreId:'T1',title:'服务方案',blocks:[{type:'p',text:'原正文',covers:['E1']}]};section.qualityReport={version:1,status:'reviewed',rows:[],fingerprint:quality.fingerprint(section)};assert.equal(require('../src/rules/check').checkWritingQuality({sections:[section]}).length,0);section.blocks[0].text='人工修改后的正文';const rows=require('../src/rules/check').checkWritingQuality({sections:[section]});assert.equal(rows[0].level,'warn');assert.match(rows[0].detail,/正文已有修改/);
});
test('高分长要素会再拆段生成，不让单次请求承担整条超长输出',async()=>{
 const one={...group,rows:group.rows.slice(0,1)},plan={perElementLow:4200,perElementHigh:6000,minPerElement:3600,minBlocks:6},segments=[];
 const result=await mockModel(async spec=>{const c=JSON.parse(spec.user.split('已核对的项目信息与响应要求（需在相关段落写明条款号）：\n')[1]);segments.push(c.elementSegment.index);assert.ok(c.writingPlan.perElementHigh<=2400);return sectionResult(spec,'分段'+c.elementSegment.index);},()=>content.generate(one,{writingPlan:plan}));assert.deepEqual(segments,[1,2,3]);assert.equal(content.validateDepth(result.data.items[0],one,plan),null);
});
test('拦截未经依据核定的保管年限及降级使用承诺，允许明确禁止和有依据的期限',()=>{
 const s=text=>({blocks:[{type:'p',text,covers:['E1']}]});assert.match(quality.validateGrounding(s('材料不合格时经确认后降级使用。')),/降级使用/);assert.equal(quality.validateGrounding(s('不合格材料不得降级使用，应隔离报审并复验。')),null);assert.match(quality.validateGrounding(s('记录保存期限至竣工验收后不少于两年。')),/缺少项目依据/);assert.equal(quality.validateGrounding(s('记录保存期限不少于两年。'),{source:'采购人要求记录保管两年。'}),null);assert.equal(quality.validateGrounding(s('档案保管期限按合同及适用要求核定。')),null);
});
test('有页数上限时拒绝超预算的长段落，不能只提高字数不管招标边界',()=>{
 const one={...group,rows:group.rows.slice(0,1)},section={blocks:blocks(one.rows[0])},plan={minPerElement:100,minBlocks:1,perElementHigh:300,constrained:true};assert.match(content.validateDepth(section,one,plan),/超出本章页数预算/);assert.equal(content.validateDepth(section,one,{...plan,constrained:false}),null);
});
