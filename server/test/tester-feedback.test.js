'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseFile,buildSections}=require('../src/parse'),{ruleScores,context}=require('../src/pipeline/score-source'),{validateScores}=require('../src/pipeline/validation');
test('DOCX 目录中的空评审章节不能取代正文；表格断字空格仍抽齐45分技术项',async()=>{
 const zip=new(require('jszip'))(),names=['总体服 务方案','分项专项服务方案','履约保障','应急方案','服务承诺'],scores=[15,6,10,10,4];
 const p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`,row=cells=>'<w:tr>'+cells.map(c=>'<w:tc>'+p(c)+'</w:tc>').join('')+'</w:tr>';
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('第四章 第一阶段入围供应商的评审标准\t21')}${p('第五章 框架协议文本\t27')}${p('第四章 第一阶段入围供应商的评审标准')}${p('真实评审正文，供应商按照以下技术评分细则进行响应。'.repeat(10))}<w:tbl>${row(['商务 部分 （55分）','项目负责人资历和业绩','55','每项合同得5分'])}${names.map((n,i)=>row([i===0?'技术 部分 （45分）':'',n,String(scores[i]),'完整、针对性方案计'+scores[i]+'分，不完整计1分，未提供计0分。'])).join('')}</w:tbl>${p('第五章 框架协议文本')}</w:body></w:document>`);
 const doc=await parseFile(await zip.generateAsync({type:'nodebuffer'}),'断字评分.docx'),sections=buildSections(doc),result=ruleScores(sections);
 assert.deepEqual(result.items.map(r=>r.item),names.map(n=>n.replace(/ /g,'')));assert.equal(result.items.reduce((n,s)=>n+s.score,0),45);assert.equal(validateScores(result,sections),null);assert.match(context(sections),/针对性方案/);assert.doesNotMatch(context(sections),/\t21/);
 const mixed={items:[...result.items,{id:'S6',item:'项目负责人资历和业绩',score:55,tierDesc:'每项合同得5分'}]};assert.match(validateScores(mixed,sections),/综合|商务/);
});
test('导出稿有编号的章节标题、要素标题及独立表名，原稿不被修改',async()=>{
 const tender={sections:[{scoreId:'S1',title:'工程概况',blocks:[{type:'h4',text:'基本信息',covers:[]},{type:'p',text:'真实项目范围。',covers:['E1']},{type:'table',text:'项目要素表',covers:['E1'],rows:[['要素','内容'],['范围','咨询服务']]}]}]},before=JSON.stringify(tender);
 const data=await require('../src/export').buildDocx(tender,false,{font:'宋体',size:12,line:'22',blindMode:true,autoToc:true,headerFooter:true}),zip=await require('jszip').loadAsync(data),xml=await zip.file('word/document.xml').async('string'),styles=await zip.file('word/styles.xml').async('string');
 assert.match(xml,/>1 工程概况</);assert.match(xml,/>1\.1 基本信息</);assert.match(xml,/>表 1-1 项目要素表</);assert.match(xml,/<w:tblGrid>/);assert.match(xml,/w:tcW/);assert.match(styles,/w:default="1"/);assert.match(styles,/w:outlineLvl w:val="0"/);assert.equal(JSON.stringify(tender),before);
 const old={sections:[{scoreId:'x',title:'第一章 服务方案',blocks:[{type:'p',text:'实施措施',covers:['E1']}]}],elements:[{scoreId:'x',rows:[{elementId:'E1',name:'实施流程'}]}]};const out=require('../src/export-headings').exportSections(old);assert.equal(out[0].title,'第一章 服务方案');assert.equal(out[0].blocks[0].type,'h4');
});
test('按技术分值分配总页数，人工零分章节不改写，页数上限和缺章受保护',()=>{
 const t={blueprint:[{scoreId:'a',score:30},{scoreId:'b',score:10},{scoreId:'c',score:0}],sections:[{scoreId:'a',blocks:[{type:'p',text:'原稿'.repeat(10)}]},{scoreId:'b',blocks:[{type:'p',text:'质量计划'}]},{scoreId:'c',blocks:[{type:'p',text:'人工补充'}]}]};
 const {plan}=require('../src/expansion'),r=plan(t,100);assert.deepEqual(r.rows.map(r=>r.targetPages),[75,25,0]);assert.equal(r.rows[2].addWords,0);assert.equal(r.totalScore,40);
 for(const n of [0,1.5,301,NaN])assert.throws(()=>plan(t,n),/整数/);t.parse={project:{pageLimit:'技术标不超过80页'}};assert.throws(()=>plan(t,100),/上限/);assert.throws(()=>plan({...t,sections:t.sections.slice(0,2)},50),/补齐/);
});
test('微信预览失败仍显示下载成功和替代预览提示，导出页移除保存和发送入口',async()=>{
 let cfg;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/export/export.js'),'utf8'),{Page:p=>cfg=p,require:()=>({action:async(p,fn)=>fn(),download:async()=>({filePath:'saved/bid.docx',ext:'docx',opened:false})}),wx:{showToast(){}}});
 const page={...cfg,data:clone(cfg.data),setData(p){Object.assign(this.data,p);}};await page.download();assert.equal(page.data.exportProgress,100);assert.equal(page.data.exportLabel,'文件已下载');assert.match(page.data.exportHint,/导出 PDF/);assert.equal(page.saveToDisk,undefined);assert.equal(page.shareExport,undefined);
 const markup=fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/export/export.wxml'),'utf8');assert.doesNotMatch(markup,/保存到电脑|发送文件|saveToDisk|shareExport/);
});
const clone=x=>JSON.parse(JSON.stringify(x));
test('已下载的云端Word遇到微信预览失败，服务层返回可保存路径，不误报下载失败',async()=>{
 const module={exports:{}},local={filePath:'saved/technical.docx',ext:'docx'};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module,require:n=>{assert.equal(n,'./cloud-transport');return {download:async()=>local};},getApp:()=>({globalData:{cloudHosting:{enabled:true}}}),wx:{cloud:{callContainer(){}},getStorageSync:()=>'T1',openDocument:o=>o.fail({errMsg:'不兼容'})}});
 const value=await module.exports.download(false,{format:'word'});assert.equal(value.filePath,local.filePath);assert.equal(value.opened,false);
});
