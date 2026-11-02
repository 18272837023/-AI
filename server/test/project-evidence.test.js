'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const a=require('../src/pipeline/analysis');
const {PROMPTS}=require('../src/pipeline/units');

test('封面“招 标 文 件”分散排字仍识别跨行标段名称，不被后面的空白格式覆盖',()=>{
 const {extractName}=require('../src/project-name');
 const doc={pages:[{page:1,text:'示例新能源园建设项目（二标段）（项目名称）\n示例新能源园建设项目（二标段）（标段名称）施\n工招标\n招 标 文 件\n招标编号：TEST-2026-001'},{page:52,text:'工程名称 | （项目名称） （标段名称）'}]};
 assert.equal(extractName(doc).name,'示例新能源园建设项目（二标段）');assert.equal(extractName(doc).evidence.page,1);
});
test('空白项目名称模板不能充当事实，实际表格中的项目名仍可读取',()=>{
 const {extractName,cleanName}=require('../src/project-name');assert.equal(cleanName('| （项目名称） （标段名称）'),'');assert.equal(extractName({pages:[{page:52,text:'工程名称 | （项目名称） （标段名称）'}]}).name,'');assert.equal(extractName({pages:[{page:8,text:'工程名称 | 示例工程'}]}).name,'示例工程');
});

test('长目录不占满项目上下文，公告、须知表及封面完整编号优先信息仍进入模型',()=>{
 const toc=Array.from({length:1800},(_,i)=>`合同与技术条款${i} ........................................ ${i+1}`).join('\n');
 const sections=[{page:1,title:'文档开头',text:'示例厂房建设项目\n'+toc},{page:18,title:'招标公告',text:'招标编号：TEST-2026-001003001\n招标人为示例建设中心\n合同估算价：4794.77万元'}];
 const pages=[{page:1,text:'示例厂房建设项目\n招标编号：TEST-2026-001'},{page:2,text:'目录\n'+toc},{page:18,text:sections[1].text},{page:19,text:'计划工期：365日历天'},{page:27,text:'4.2.1 | 投标截止时间 | 2026-11-20 09:00:00'}];
 for(const context of [a.projectContext(sections),a.projectContext(sections,pages)]){assert.ok(context.length<55000);assert.match(context,/4794.77万元/);assert.match(context,/TEST-2026-001003001/);assert.doesNotMatch(context,/\.\.{5}/);}
 const prompt=PROMPTS.projectInfo(sections,pages).user;assert.match(prompt,/365日历天/);assert.match(prompt,/2026-11-20 09:00:00/);assert.match(prompt,/P27/);assert.match(prompt,/不使用页脚印刷页码/);
});
test('跨页日期只合并相邻页，移除有连续页码证明的页脚并记录实际页范围',()=>{
 const pages=[{page:20,text:'5.1 投标文件递交截止时间为：2026年11月20日09时00\n4'},{page:21,text:'分\n5.2 投标文件提交要求\n5'}];
 const p={deadline:'2026年11月20日09时00分',fieldEvidence:{deadline:{section:'投标截止',page:4,quote:'投标文件递交截止时间为：2026年11月20日09时00分'}}};
 a.normalizeProject(p,[],pages);assert.equal(p.fieldEvidence.deadline.page,20);assert.equal(p.fieldEvidence.deadline.endPage,21);assert.equal(a.validateProject(p,[],pages),null);assert.match(p.fieldEvidence.deadline.quote,/00\n分/);
 assert.equal(a.quoteExists({page:21,quote:p.fieldEvidence.deadline.quote},[],pages),false);
 assert.equal(a.quoteExists({page:20,quote:'投标文件递交截止时间为：2026年11月20日09时00分'},[],[{page:20,text:'投标文件递交截止时间为：2026年11月20日09时00'},{page:22,text:'分'}]),false);
});
test('单独成行的工期或金额不被误删为页码，不能靠删掉数字拼接伪引文',()=>{
 const pages=[{page:1,text:'合同估算价：\n1000'},{page:2,text:'单位万元\n2'}];
 assert.match(a.projectContext([],pages),/1000/);
 assert.equal(a.quoteExists({page:1,quote:'合同估算价：单位万元'},[],pages),false);
});
test('表格跨列引用还原为真实连续原文，保留夹在中间的条款号及字段名',()=>{
 const pages=[{page:24,text:'质量目标：达到国家现行施工质量验收规范要求，并\n1.3.3 | 质量要求 | 达到合格标准\n8'},{page:25,text:'其他资料\n9'}];
 const p={quality:'达到国家现行施工质量验收规范要求，并达到合格标准',fieldEvidence:{quality:{section:'须知表',page:8,quote:'质量目标：达到国家现行施工质量验收规范要求，并达到合格标准'}}};
 a.normalizeProject(p,[],pages);assert.equal(p.fieldEvidence.quality.page,24);assert.match(p.fieldEvidence.quality.quote,/1\.3\.3 \| 质量要求 \|/);assert.equal(a.validateProject(p,[],pages),null);
 const forged={quality:'达到优良标准',fieldEvidence:{quality:{page:24,quote:'质量目标：达到优良标准'}}};a.normalizeProject(forged,[],pages);assert.match(a.validateProject(forged,[],pages),/原文证据/);
});
test('引用按物理页验证，章节开始页不能代替正文实际页；多处重复不猜改页码',()=>{
 const sections=[{page:18,title:'招标范围',text:'计划工期：365日历天\n合同估算价：4794.77万元'}],pages=[{page:18,text:'招标范围'},{page:19,text:sections[0].text}];
 const p={budget:'4794.77万元',fieldEvidence:{budget:{page:3,quote:'合同估算价：4794.77万元'}}};a.normalizeProject(p,sections,pages);assert.equal(p.fieldEvidence.budget.page,19);assert.equal(a.validateProject(p,sections,pages),null);
 const ambiguous={budget:'100万元',fieldEvidence:{budget:{page:1,quote:'合同估算价：100万元'}}};const repeated=[{page:9,text:'合同估算价：100万元'},{page:11,text:'合同估算价：100万元'}];a.normalizeProject(ambiguous,[],repeated);assert.equal(ambiguous.fieldEvidence.budget.page,1);assert.match(a.validateProject(ambiguous,[],repeated),/原文证据/);
});
test('空缺事实和改写数值仍被校验拒绝，不用空白结果掩盖失败',()=>{
 const pages=[{page:18,text:'招标人为示例建设中心\n合同估算价：4794.77万元'}];assert.match(a.validateProject({},[],pages),/招标人/);
 const p={purchaser:'示例建设中心',budget:'4794.78万元',fieldEvidence:{purchaser:{page:18,quote:'招标人为示例建设中心'},budget:{page:18,quote:'合同估算价：4794.78万元'}}};a.normalizeProject(p,[],pages);assert.match(a.validateProject(p,[],pages),/预算或合同估算价.*原文证据/);
});
test('模型重试仍不合格时，具体字段原因传递到失败处理，不再只有笼统重试提示',async()=>{
 const config=require('../src/config'),llm=require('../src/lib/llm'),originalFetch=global.fetch,live=config.llm.live;let received;
 try{config.llm.live=true;global.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"budget":"100万元"}'}}]})});
 await assert.rejects(llm.runUnit({name:'原文失败诊断',system:'test',user:'test',maxRetries:0,schema:{type:'object',required:['budget'],properties:{budget:{type:'string'}}},validateData:()=> '预算或合同估算价缺少可定位的原文证据',fallback:async({reason})=>{received=reason;throw Error('项目要素抽取未完成；具体原因：'+reason);}}),/具体原因：预算或合同估算价/);assert.match(received,/原文证据/);
 }finally{global.fetch=originalFetch;config.llm.live=live;}
});
