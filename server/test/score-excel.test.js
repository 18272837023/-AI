'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {parseFile,buildSections}=require('../src/parse');
const {context,ruleScores}=require('../src/pipeline/score-source');
const {validateScores}=require('../src/pipeline/validation');
const {PROMPTS}=require('../src/pipeline/units');
const XLSX=require('xlsx');

const rows=[['技术部分（45分）','总体服务方案','15','方案符合实际需求计3分，不完整计2分，未提供计0分。本评审项最多得15分。'],
 ['', '分项专项服务方案','6','工程管理、造价咨询、招标代理三个方案，每项完整计2分，未提供计0分。'],
 ['', '履约保障','10','质量管控、时效保障、保密管理、廉洁从业、合规履约，每项完整计2分。'],
 ['', '应急方案','10','人员突发变动、紧急任务、质量事故、信息安全、响应时效，每项完整计2分。'],
 ['', '服务承诺','4','符合实际且可行计4分，完整计3分，缺漏计2分，未针对项目计1分，未提供计0分。']];

test('综合标跨页合并父类排除，技术人员配置保留；模型不能将综合标子项混入',()=>{
 const sections=[{no:'第四章',title:'评审标准',text:'综合标（30分） | 企业业绩 | 10 | 每项业绩计2分\n | 人员资格 | 20 | 每证书计2分'},
 {no:'',title:'续表',text:' | 服务评价 | 5 | 每份评价计1分\n技术部分（15分） | 技术实施方案 | 10 | 方案完整计10分\n | 技术人员安排 | 5 | 进度组织完整计5分\n综合部分（5分）\n | 财务状况 | 5 | 财务评分'}];
 const result=ruleScores(sections);assert.deepEqual(result.items.map(r=>r.item),['技术实施方案','技术人员安排']);assert.equal(validateScores(result,sections),null);assert.doesNotMatch(result.items.at(-1).tierDesc,/财务/);
 const mixed={items:[{id:'S1',item:'服务评价',score:5,tierDesc:'每份评价计1分'}]};assert.match(validateScores(mixed,sections),/综合|商务|资信/);
});

test('服务类评分表：裸分值、合并类别及跨页续表抽取五项合计45分，不把0分档次当子项',()=>{
 const sections=[{no:'第四章',title:'评审标准',page:24,text:rows.slice(0,3).map(r=>r.join(' | ')).join('\n')},
 {no:'',title:'续表',page:25,text:'（2）不完整计1分；（3）未针对本项目计0.5分；（4）未提供计0分。\n'+rows.slice(3).map(r=>r.join(' | ')).join('\n')},
 {no:'第五章',title:'框架协议文本',page:26,text:'合同内容'}];
 const result=ruleScores(sections);
 assert.deepEqual(result.items.map(r=>r.item),rows.map(r=>r[1]));
 assert.deepEqual(result.items.map(r=>r.score),[15,6,10,10,4]);
 assert.equal(validateScores(result,sections),null);
 assert.match(result.items[2].tierDesc,/不完整计1分/);
 assert.equal(result.items[3].evidence.page,25);
 assert.doesNotMatch(context(sections),/合同内容/);
});

test('DOCX 按单元格保留评分名称、分值、标准，并保留首个章节前的评分表',async()=>{
 const zip=await require('jszip').loadAsync(fs.readFileSync(path.join(__dirname,'../samples/示例招标文件.docx')));
 const xml=await zip.file('word/document.xml').async('string');
 const p=t=>'<w:p><w:r><w:t>'+t+'</w:t></w:r></w:p>';
 const table='<w:tbl>'+rows.map(row=>'<w:tr>'+row.map(cell=>'<w:tc>'+p(cell)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
 zip.file('word/document.xml',xml.replace(/<w:body>[\s\S]*<\/w:body>/,'<w:body>'+p('评审标准')+table+p('第五章 框架协议文本')+p('合同条款')+'</w:body>'));
 const doc=await parseFile(await zip.generateAsync({type:'nodebuffer'}),'评审表.docx');
 assert.match(doc.text,/分项专项服务方案 \| 6 \| 工程管理/);
 const result=ruleScores(buildSections(doc));
 assert.deepEqual(result.items.map(s=>s.score),[15,6,10,10,4]);
});

test('没有“评标办法”标题的长评分表末尾仍完整送入模型，不再截成2600字',()=>{
 const sections=[{no:'',title:'其他信息',page:1,text:'评审标准\n'+('详细评分说明，不完整计1分。'.repeat(400))+'\n服务承诺 | 4 | 最后评分项原文尾标记计4分'}];
 assert.match(PROMPTS.scores(sections).user,/最后评分项原文尾标记/);
 assert.throws(()=>context([{text:'评分标准'+ '字'.repeat(120001)}]),/未截断评分表/);
});

for(const ext of ['xlsx','xls'])test(`Excel ${ext} 清单保留工作表、行号、工程量单位和多工作表，小清单也可解析`,async()=>{
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['项目编码','项目名称','单位','工程量'],['010101','挖一般土方','m³',120.5]]),'土建清单');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['项目名称','单位','工程量'],['给水管','m',85]]),'安装清单');
 const doc=await parseFile(XLSX.write(book,{type:'buffer',bookType:ext==='xls'?'biff8':'xlsx'}),'工程量清单.'+ext);
 assert.equal(doc.pages.length,2);assert.equal(doc.pageKnown,false);
 assert.match(doc.text,/第2行 \| 010101 \| 挖一般土方 \| m³ \| 120.5/);
 const sections=buildSections(doc).map(s=>({...s,fromAttachment:'工程量清单.'+ext}));
 assert.equal(sections.length,2);
 assert.match(require('../src/pipeline/attachment-context').attachmentContext(sections,'施工方案'),/土建清单[\s\S]*120.5[\s\S]*安装清单/);
});

test('伪装及过大 Excel 明确报错，不以空文本继续',async()=>{
 await assert.rejects(parseFile(Buffer.from('not a workbook'),'清单.xlsx'),/内容与扩展名不符/);
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['清单']]);sheet['!ref']='A1:A20001';
 XLSX.utils.book_append_sheet(book,sheet,'超限清单');
 await assert.rejects(parseFile(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'清单.xlsx'),/过大/);
});

test('解析失败停止进度并标出需重试；再次点击确实启动新请求并能完成',async()=>{
 let page,attempt=0;
 const api={action:async(p,fn)=>{try{return await fn();}catch(_){}},refresh:async()=>({name:'测试项目'}),ensure:async(name,field,progress)=>{
  attempt++;progress({step:5,progress:83});if(attempt===1)throw Error('评分抽取失败');
 }};
 require('node:vm').runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/parsing/parsing.js'),'utf8'),{Page:p=>page=p,require:()=>api});
 page.data=JSON.parse(JSON.stringify(page.data));page.setData=p=>Object.assign(page.data,p);
 await page.start();assert.equal(page.data.steps[4].status,'error');assert.match(page.data.error,/评分/);
 const shown=page._shown;page.tick();assert.equal(page._shown,shown);
 await page.start();assert.equal(attempt,2);assert.equal(page.data.error,'');assert.equal(page._done,true);
 assert.ok(page.data.steps.every(s=>s.status==='done'));
});
