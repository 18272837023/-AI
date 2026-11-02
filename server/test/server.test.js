'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tender-test-'));
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.LLM_MODE = 'mock';
const { detectExt } = require('../src/parse');
const { createRouter } = require('../src/lib/http');
const { routes } = require('../src/api');
const store = require('../src/lib/store');
const llm = require('../src/lib/llm');
const server = createRouter(routes);
let base;
const ready = new Promise(resolve => server.listen(0, '127.0.0.1', () => {
  base = `http://127.0.0.1:${server.address().port}`;
  resolve();
}));
after(async () => {
  await new Promise(resolve => server.close(resolve));
  store.flush();
  fs.rmSync(tmp, { recursive: true, force: true });
});
async function request(url, body) {
  await ready;
  const res = await fetch(base + url, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  return { status: res.status, ...(await res.json()) };
}
async function upload(id, text, name = 'first.txt') {
  return fetch(`${base}/v1/tenders/${id}/files`, {
    method: 'POST', headers: { 'x-filename': name }, body: text
  });
}
async function stage(id, name) {
  const started = await request(`/v1/tenders/${id}/${name}`, {});
  assert.equal(started.status, 200, JSON.stringify(started));
  for (let i = 0; i < 200; i++) {
    const job = (await request(`/v1/jobs/${started.data.jobId}`)).data;
    if (job.status === 'done' || job.status === 'failed') {
      assert.equal(job.status, 'done', job.error);
      assert.equal(job.progress, 100);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('任务超时');
}

test('异常 URL / JSON 不会中断服务', async () => {
  assert.equal((await request('/v1/tenders/%ZZ')).status, 400);
  for (const body of [null, [], 'abc', { name: {} }]) {
    assert.equal((await request('/v1/tenders', body)).status, 400);
  }
  assert.equal((await request('/v1/health')).status, 200);
});

test('旧版 DOC 不应被误当成 DOCX', () => {
  assert.equal(detectExt('old.doc'), null);
  assert.equal(detectExt('new.docx'), 'docx');
});

test('规则基线同样需要通过 Schema 校验', async () => {
  await assert.rejects(llm.runUnit({ name: 'bad', schema: {
    type: 'object', required: ['items']
  }, fallback: async () => ({}) }), /结构不合格/);
});

test('云传输分片上传校验完整性、完成重试不重复文件，分片导出还原真实DOCX',async()=>{
 const id=(await request('/v1/tenders',{})).data.id;
 const sample=fs.readFileSync(path.join(__dirname,'../samples/示例招标文件.txt'));
 const bytes=Buffer.concat([sample,Buffer.alloc(280000,32)]);
 const s=(await request(`/v1/tenders/${id}/uploads`,{name:'cloud.txt',size:bytes.length})).data;
 assert.equal((await request(`/v1/tenders/${id}/uploads/${s.uploadId}/complete`,{})).status,400);
 for(let at=0,index=0;at<bytes.length;at+=s.chunkSize,index++)assert.equal((await request(`/v1/tenders/${id}/uploads/${s.uploadId}/parts`,{index,base64:bytes.subarray(at,at+s.chunkSize).toString('base64')})).status,200);
 for(let i=0;i<2;i++)assert.equal((await request(`/v1/tenders/${id}/uploads/${s.uploadId}/complete`,{})).status,200);
 assert.equal(store.getTender(id).files.length,1);
 const original=await require('../src/lib/files').get(store.getTender(id).files[0].storedName);assert.deepEqual(original,bytes);
 for(const stageName of ['parse','blueprint','elements','generate'])await stage(id,stageName);
 const exported=await request(`/v1/tenders/${id}/export?draft=1&cloud=1`);assert.equal(exported.status,200);
 const chunks=[];for(let i=0;i<exported.data.parts;i++){const part=await request(`/v1/tenders/${id}/export-parts?downloadId=${exported.data.downloadId}&index=${i}`);chunks.push(Buffer.from(part.data.base64,'base64'));}
 const docx=Buffer.concat(chunks);assert.equal(docx.length,exported.data.size);assert.equal(docx.subarray(0,2).toString(),'PK');
});

test('Excel 清单须作为附件，上传后真正进入解析和后续写作上下文',async()=>{
 const XLSX=require('xlsx'),book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['项目名称','单位','工程量'],['混凝土基础','m³',123.45]]),'土建工程量');
 const data=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 const id=(await request('/v1/tenders',{})).data.id;
 assert.equal((await upload(id,data,'boq.xlsx')).status,400);
 await upload(id,fs.readFileSync(path.join(__dirname,'../samples/示例招标文件.txt')));
 assert.equal((await upload(id,data,'boq.xlsx')).status,200);
 await stage(id,'parse');
 const t=store.getTender(id);
 assert.ok(t.parse.attachments.some(a=>a.name==='boq.xlsx'&&a.used));
 const source=require('../src/pipeline/attachment-context').attachmentContext(t.doc.sections,'施工方案');
 assert.match(source,/混凝土基础.*123.45/);
});

test('评分抽取失败后重试复用已完成项目/资格，新增附件使断点失效',async()=>{
 const id=(await request('/v1/tenders',{})).data.id;
 await upload(id,fs.readFileSync(path.join(__dirname,'../samples/示例招标文件.txt')));
 const original=llm.runUnit,calls=[];let failed=false;
 try {
  llm.runUnit=async spec=>{calls.push(spec.name);if(spec.name==='M06 评分细则'&&!failed){failed=true;throw Error('模拟评分表抽取失败');}return original(spec);};
  const first=await request(`/v1/tenders/${id}/parse`,{});
  for(let i=0;i<200;i++){const j=(await request('/v1/jobs/'+first.data.jobId)).data;if(j.status==='failed')break;await new Promise(r=>setTimeout(r,10));}
  assert.ok(store.getTender(id).parseCheckpoint.qualifications);
  await stage(id,'parse');
  assert.equal(calls.filter(n=>n==='M04 项目要素').length,1);
  assert.equal(calls.filter(n=>n==='M05 合格性条款').length,1);
  assert.equal(calls.filter(n=>n==='M06 评分细则').length,2);
  assert.equal(store.getTender(id).parseCheckpoint,null);
  await upload(id,Buffer.from('技术要求\n'+'新附件技术要求，须逐项核对。'.repeat(25)),'new.txt');
  await stage(id,'parse');
  assert.equal(calls.filter(n=>n==='M04 项目要素').length,2);
 }finally{llm.runUnit=original;}
});

test('HTTP 全链、附件并入解析及重跑清理', async () => {
  const id = (await request('/v1/tenders', {})).data.id;
  const sample = fs.readFileSync(path.join(__dirname, '../samples/示例招标文件.txt'), 'utf8');
  assert.equal((await upload(id, sample, 'latest.txt')).status, 200);
  // 第二份文件按附件处理：不覆盖项目名，解析时并入章节树
  assert.equal((await upload(id, '技术要求附件\n\n' + '管道压力等级不低于 1.6MPa，焊缝按二级焊缝标准进行无损检测。\n'.repeat(8), 'tech-spec.txt')).status, 200);
  assert.equal((await request(`/v1/tenders/${id}`)).data.name, 'latest', '附件不能把项目名改掉');
  for (const name of ['parse', 'blueprint', 'elements', 'generate']) await stage(id, name);
  const detail = (await request(`/v1/tenders/${id}`)).data;
  assert.equal(detail.file.name, 'latest.txt');
  assert.equal(detail.attachments, 1);
  assert.ok(detail.parse.attachments.some(a => a.name === 'tech-spec.txt' && a.used));
  assert.ok(detail.doc.sections.some(s => /【附件：tech-spec\.txt】/.test(s.title)), '附件章节应并入原文');
  assert.ok(detail.sections.length > 0);
  assert.ok(detail.parse.scores.length > 0);
  assert.equal((await request(`/v1/tenders/${id}/check`, {})).status, 200);
  await stage(id, 'blueprint');
  assert.equal(store.getTender(id).sections, null);
  assert.equal(store.getTender(id).check, null);
  assert.equal((await request(`/v1/tenders/${id}/generate`, {})).status, 400);
  await upload(id, sample, 'new.txt');
  assert.equal(store.getTender(id).parse, null);
});

test('同阶段复用任务，不同阶段及上传被互斥保护', async () => {
  const id = (await request('/v1/tenders', {})).data.id;
  const job = store.createJob(id, 'parse', 6);
  store.updateTender(id, { files: [{ name: 'x.txt' }], parse: { scores: [] } });
  const reused = await request(`/v1/tenders/${id}/parse`, {});
  assert.equal(reused.data.reused, true);
  assert.equal(reused.data.jobId, job.id);
  assert.equal((await request(`/v1/tenders/${id}/blueprint`, {})).status, 409);
  assert.equal((await upload(id, 'content')).status, 409);
  store.updateJob(job.id, { status: 'failed' });
});


test('编辑保存、版本冲突、Word 草稿与正式导出门禁', async () => {
  const id = (await request('/v1/tenders', { name: '人工编辑测试' })).data.id;
  const sample = fs.readFileSync(path.join(__dirname, '../samples/示例招标文件.txt'), 'utf8');
  await upload(id, sample);
  for (const name of ['parse', 'blueprint', 'elements', 'generate']) await stage(id, name);
  const url = `/v1/tenders/${id}`;
  let t = (await request(url)).data;
  async function put(field, value, revision = t.revision) {
    const res = await fetch(base + url + '/' + field, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision, value }) });
    return { status: res.status, ...(await res.json()) };
  }
  assert.equal((await fetch(base + url + '/export')).status, 409);
  let res = await fetch(base + url + '/export?draft=1');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /wordprocessingml/);
  const mammoth = require('mammoth');
  let buffer = Buffer.from(await res.arrayBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.match((await mammoth.extractRawText({ buffer })).value, /测试草稿/);
  const old = t.revision;
  const sections = structuredClone(t.sections);
  const anchors = t.parse.qualifications.filter(q => q.resp === 'tech').map(q => q.no || q.anchor).join('、');
  sections.forEach(s => s.blocks.forEach(b => b.text = '现场核对后实施，责任岗位每日复核。'));
  sections[0].blocks[0].text += anchors;
  assert.equal((await put('sections', sections)).status, 200);
  assert.equal((await put('sections', sections, old)).status, 409);
  t = (await request(url)).data;
  assert.match(t.sections[0].plain, /现场核对/);
  const supplements=require('../src/supplements');const declared=supplements.getGroups(store.getTender(id));declared.forEach(g=>g.declared=true);await putSupplements(store.getTender(id),declared);t=(await request(url)).data;
  assert.equal(t.check.blocking, 0, JSON.stringify(t.check));
  res = await fetch(base + url + '/export');
  assert.equal(res.status, 200);
  buffer = Buffer.from(await res.arrayBuffer());
  const text = (await mammoth.extractRawText({ buffer })).value;
  assert.match(text, /现场核对/);
  assert.doesNotMatch(text, /测试草稿/);
  const invalid = structuredClone(t.sections);
  invalid[0].blocks[0].covers = ['nonexistent'];
  assert.equal((await put('sections', invalid)).status, 400);
  const elements = structuredClone(t.elements);
  elements[0].rows[0].params = '经人工核定 100 米';
  assert.equal((await put('elements', elements)).status, 200);
  t = (await request(url)).data;
  assert.equal(t.sections, null);
  assert.equal(t.check, null);
  assert.equal(t.elements[0].rows[0].params, '经人工核定 100 米');
  const disk = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'));
  assert.equal(disk.tenders[id].elements[0].rows[0].params, '经人工核定 100 米');
});

test('要素覆盖按评分项区分相同的 E1，空正文不能通过', () => {
  const checks = require('../src/rules/check');
  const t = { blueprint: [ {scoreId:'S1',item:'A',elements:[{id:'E1'}]}, {scoreId:'S2',item:'B',elements:[{id:'E1'}]} ], sections:[{scoreId:'S1',plain:'text',blocks:[{text:'text',covers:['E1']}]}] };
  assert.ok(checks.checkElementCoverage(t).some(i => i.level === 'block' && i.id === 'C2-S2'));
  assert.ok(checks.checkAll({}).blocking > 0);
});


test('统一入口提供原前端和真实接口模块，数据映射不混入示例', async () => {
  await ready;
  const home = await fetch(base + '/');
  assert.match(await home.text(), /runtime.js/);
  const vm = require('node:vm');
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../miniprogram/utils/service.js'), 'utf8'), {module, exports:module.exports});
  const v = module.exports.view({id:'test',name:'实际项目',file:{name:'actual.docx',size:2000},parse:{project:{name:'实际工程',duration:'100天'},scoreSum:25,scores:[{id:'S1',item:'实际评分',score:25,keywords:[],tierDesc:'原文'}],qualifications:[],outline:{mode:'free'}},blueprint:[{scoreId:'S1',elements:[{id:'E1',name:'实际要素',mustHave:'核对'}]}],sections:[]});
  assert.equal(v.project.name, '实际工程');
  assert.equal(v.project.techScore, 25);
  assert.equal(v.project.budget, '尚未识别');
  assert.equal(v.scoreItems[0].name, '实际评分');
  assert.equal(v.scoreItems[0].done, 0);
});


test('名称识别支持跨行表格、封面和空结果，不使用文件名冒充', () => {
  const {extractName} = require('../src/project-name');
  const from = text => extractName({pages:[{page:1,text}]}).name;
  assert.equal(from('1.1 项目名称：滨江综合能源工程\n招标人：测试'), '滨江综合能源工程');
  assert.equal(from('项目名称\n滨江综合能源工程\n招标编号：01'), '滨江综合能源工程');
  assert.equal(from('滨江综合能源工程\n招标文件'), '滨江综合能源工程');
  assert.equal(from('项目名称\n建设地点：机场西侧'), '');
  assert.equal(from('本文件无名称字段'), '');
});

test('预识别回填项目、完整解析同步名称、人工名称不被覆盖', async () => {
  const id = (await request('/v1/tenders', {})).data.id;
  const sample = fs.readFileSync(path.join(__dirname, '../samples/示例招标文件.txt'), 'utf8');
  await upload(id,sample,'unrelated.txt');
  const url = `/v1/tenders/${id}`;
  let result = await request(url+'/identify-name',{});
  assert.equal(result.status,200);
  assert.equal(result.data.name,'滨江国际机场综合能源站工程');
  assert.equal(result.data.tender.name,result.data.name);
  assert.equal(result.data.tender.nameSource,'document');
  await stage(id,'parse');
  let t=(await request(url)).data;
  assert.equal(t.name,t.parse.project.name);
  const renamed = await fetch(base+url+'/name',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:t.revision,name:'人工指定名称'})});
  assert.equal(renamed.status,200);
  await request(url+'/identify-name',{});
  await stage(id,'parse');
  t=(await request(url)).data;
  assert.equal(t.name,'人工指定名称');
  assert.equal(t.nameSource,'manual');
  const manualId=(await request('/v1/tenders',{name:'创建时手动命名'})).data.id;
  await upload(manualId,sample);
  await stage(manualId,'parse');
  assert.equal((await request(`/v1/tenders/${manualId}`)).data.name,'创建时手动命名');
});

test('显式重新识别（force）可以覆盖人工名称，默认识别不能', async () => {
  const id = (await request('/v1/tenders', {})).data.id;
  const sample = fs.readFileSync(path.join(__dirname, '../samples/示例招标文件.txt'), 'utf8');
  await upload(id, sample, 'unrelated.txt');
  const url = `/v1/tenders/${id}`;
  let t = (await request(url)).data;
  await fetch(base+url+'/name',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:t.revision,name:'我自己起的名字'})});
  // 默认识别：保护人工名称
  let r = await request(url+'/identify-name',{});
  assert.equal(r.data.applied,false);
  assert.equal((await request(url)).data.name,'我自己起的名字');
  // 显式重新识别：直接生效
  r = await request(url+'/identify-name',{force:true});
  assert.equal(r.data.applied,true);
  assert.equal(r.data.name,'滨江国际机场综合能源站工程');
  t = (await request(url)).data;
  assert.equal(t.name,'滨江国际机场综合能源站工程');
  assert.equal(t.nameSource,'document');
});

test('创建页在上传后回填名称，异步识别不会覆盖用户输入', async () => {
  const vm=require('node:vm');
  let cfg, complete;
  const api={session:{tender:{revision:1}},action:async(p,fn)=>fn(),create:async()=>({id:'test'}),upload:async()=>{},path:()=>'/v1/tenders/test',request:()=>new Promise(r=>complete=r)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/create/create.js'),'utf8'),{require:()=>api,Page:p=>cfg=p});
  const page={...cfg,data:JSON.parse(JSON.stringify(cfg.data)),setData(patch){Object.assign(this.data,patch);}};
  const operation=page.prepareFile({name:'source.docx',size:2048,path:'test'});
  while(!complete) await Promise.resolve();
  complete({name:'抽取的工程名称'});await operation;
  assert.equal(page.data.projectName,'抽取的工程名称');
  complete=null;
  const next=page.prepareFile({name:'other.docx',size:2048,path:'test2'});
  while(!complete) await Promise.resolve();
  page.onNameInput({detail:{value:'用户正在输入的名称'}});
  complete({name:'另一个自动名称'});await next;
  assert.equal(page.data.projectName,'用户正在输入的名称');
});


test('未执行拆解与实际零要素区分，部分施工图也不能显示全部完成', () => {
 const vm=require('node:vm'), module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module,exports:module.exports});
 const t={name:'待拆解项目',parse:{scores:[{id:'S1',item:'设计方案'},{id:'S2',item:'施工方案'}]}};
 let v=module.exports.view(t);
 assert.equal(v.blueprintStats.ready,false);
 assert.equal(v.blueprintStats.pendingItems,2);
 assert.equal(v.scoreItems[0].elementsReady,false);
 t.blueprint=[{scoreId:'S1',elements:[{id:'E1',name:'专项方案',mustHave:'措施'}]}];
 v=module.exports.view(t); assert.equal(v.blueprintStats.ready,false); assert.equal(v.blueprintStats.pendingItems,1);
 t.blueprint.push({scoreId:'S2',elements:[{id:'E1',name:'实施要求',mustHave:'做法'}]});
 v=module.exports.view(t); assert.equal(v.blueprintStats.ready,true); assert.equal(v.blueprintStats.elements,2);
});

test('施工图内容校验拒绝评分项遗漏和空要素', async () => {
 const {validateBlueprint}=require('../src/pipeline/blueprint');
 const scores=[{id:'S1'},{id:'S2'}], row=id=>({scoreId:id,elements:[{id:'E1',name:'实际要素',mustHave:'实际要求'}]});
 assert.ok(validateBlueprint({items:[]},scores));
 assert.ok(validateBlueprint({items:[row('S1')]},scores));
 assert.ok(validateBlueprint({items:[row('S1'),row('S1')]},scores));
 assert.ok(validateBlueprint({items:[row('S1'),{scoreId:'S2',elements:[]}]},scores));
 assert.equal(validateBlueprint({items:[row('S1'),row('S2')]},scores),null);
 await assert.rejects(llm.runUnit({name:'内容校验',schema:{type:'object'},fallback:async()=>({items:[]}),validateData:d=>validateBlueprint(d,scores)}),/内容不合格/);
});


test('填写要素表先显示进度，完成后显示可编辑字段，失败可重试', async () => {
 const vm=require('node:vm'); let cfg,finish;
 const api={action:async(p,fn)=>fn(),ensure:async(stage,field,progress)=>{assert.equal(stage,'elements');progress({label:'填要素表：质量措施',progress:42});return new Promise(resolve=>finish=resolve);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/elements/elements.js'),'utf8'),{require:()=>api,Page:p=>cfg=p});
 const page={...cfg,data:JSON.parse(JSON.stringify(cfg.data)),setData(patch){Object.assign(this.data,patch);}};
 const loading=page.onShow();
 assert.equal(page.data.loading,true);assert.equal(page.data.ready,false);assert.equal(page.data.jobProgress,42);
 finish({revision:5,elements:[{scoreId:'S1',item:'质量措施',rows:[{elementId:'E1',name:'材料检查',approach:'检查合格证',params:'〔待确认：抽检比例〕',owner:'质量员',frequency:'每批次'}]}]});
 await loading;
 assert.equal(page.data.loading,false);assert.equal(page.data.ready,true);assert.equal(page.data.groups[0].entries[0].name,'材料检查');assert.equal(page.data.pendingCount,1);
 api.ensure=async()=>{throw Error('任务失败，请重试');};
 await assert.rejects(page.onShow(),/任务失败/);
 assert.equal(page.data.loading,false);assert.equal(page.data.ready,false);assert.equal(page.data.loadError,'任务失败，请重试');
});


test('逐章进度记录当前项、排队项和已完成实际字数，失败不显示完成', async () => {
 const pipeline=require('../src/pipeline/run');
 const original=llm.runUnit;
 const t=store.createTender({name:'逐章进度测试'});
 const groups=[{scoreId:'S1',item:'质量措施',rows:[{elementId:'E1'}]},{scoreId:'S2',item:'安全措施',rows:[{elementId:'E1'}]}];
 store.updateTender(t.id,{parse:{project:{},qualifications:[],outline:{}},elements:groups});
 const result=(scoreId,text)=>({data:{items:[{scoreId,title:text,blocks:[{type:'p',text,covers:['E1']}]}]},degraded:true});
 let finishFirst,finishSecond,startedFirst,startedSecond;
 const firstStarted=new Promise(r=>startedFirst=r),secondStarted=new Promise(r=>startedSecond=r);
 let calls=0;
 llm.runUnit=async()=>{calls++;return new Promise(resolve=>{if(calls===1){finishFirst=resolve;startedFirst();}else{finishSecond=resolve;startedSecond();}});};
 try {
  const job=store.createJob(t.id,'generate',2),running=pipeline.run(job.id,'generate');
  await firstStarted;
  assert.equal(store.getJob(job.id).items[0].status,'running');
  assert.equal(store.getJob(job.id).items[1].status,'queued');
  assert.equal(store.getJob(job.id).progress,0);
  finishFirst(result('S1','第一章正文'));
  await secondStarted;
  assert.equal(store.getJob(job.id).items[0].status,'done');
  assert.equal(store.getJob(job.id).items[0].wordCount,5);
  assert.equal(store.getJob(job.id).items[1].status,'running');
  assert.equal(store.getJob(job.id).progress,50);
  finishSecond(result('S2','第二章正文'));
  await running;
  assert.equal(store.getJob(job.id).status,'done');
  assert.equal(store.getJob(job.id).progress,100);
  assert.equal(store.getJob(job.id).items[1].wordCount,5);
  llm.runUnit=async()=>{throw Error('测试生成失败');};
  const failed=store.createJob(t.id,'generate',2);await pipeline.run(failed.id,'generate');
  // 单章失败不中断：两章都会跑到并各自标记失败，全部失败时整个任务才判失败
  assert.equal(store.getJob(failed.id).status,'failed');
  assert.equal(store.getJob(failed.id).items[0].status,'failed');
  assert.equal(store.getJob(failed.id).items[1].status,'failed');
 } finally {llm.runUnit=original;}
});

test('单章生成失败不拖垮整阶段，其余章节照常产出', async () => {
 const pipeline=require('../src/pipeline/run');
 const original=llm.runUnit;
 const t=store.createTender({name:'部分失败测试'});
 const groups=[{scoreId:'S1',item:'质量措施',rows:[{elementId:'E1'}]},{scoreId:'S2',item:'安全措施',rows:[{elementId:'E1'}]}];
 store.updateTender(t.id,{parse:{project:{},qualifications:[],outline:{}},elements:groups});
 let calls=0;
 llm.runUnit=async()=>{calls++;if(calls===1)throw Error('偶发失败');return {data:{items:[{scoreId:'S2',title:'安全措施',blocks:[{type:'p',text:'第二章正文内容',covers:['E1']}]}]},degraded:true};};
 try {
  const job=store.createJob(t.id,'generate',2);
  await pipeline.run(job.id,'generate');
  const j=store.getJob(job.id);
  assert.equal(j.status,'done','一章失败不应让整个任务失败');
  assert.equal(j.items[0].status,'failed');
  assert.equal(j.items[1].status,'done');
  const tender=store.getTender(t.id);
  assert.equal(tender.sections.length,1,'成功章节的正文应保留');
  assert.ok(tender.generateMeta.failed&&tender.generateMeta.failed.length===1,'失败章节应记录在元信息里');
 } finally {llm.runUnit=original;}
});

test('生成列表映射预计字数、实际字数、loading 和失败，兼容旧任务', () => {
 const vm=require('node:vm'),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module,exports:module.exports});
 const t={name:'测试',parse:{scores:[{id:'S1',item:'质量措施'},{id:'S2',item:'安全措施'}]},blueprint:[{scoreId:'S1',elements:[{id:'E1'},{id:'E2'}]},{scoreId:'S2',elements:[{id:'E1'}]}]};
 let rows=module.exports.generationChapters(t);
 assert.equal(rows[0].index,1);assert.equal(rows[0].wordLabel,'预计 300—600 字');assert.equal(rows[0].elementLabel,'2 条要素');
 rows=module.exports.generationChapters(t,{stage:'generate',status:'running',step:2,items:[{scoreId:'S1',status:'done',wordCount:320,elementCount:2},{scoreId:'S2',status:'running',wordCount:null,elementCount:1}]});
 assert.equal(rows[0].status,'ok');assert.equal(rows[0].wordLabel,'实际 320 字');assert.equal(rows[1].status,'write');assert.equal(rows[1].wordLabel,'预计 150—300 字');
 rows=module.exports.generationChapters(t,{stage:'generate',status:'failed',step:2});
 assert.equal(rows[0].status,'ok');assert.equal(rows[1].status,'error');
 rows=module.exports.generationChapters(t,{stage:'elements',status:'running',step:1});
 assert.equal(rows[0].status,'sheet');assert.equal(rows[1].status,'wait');
});


function supplementFixture() {
 const t=store.createTender({name:'恢复待补信息测试'});
 const blueprint=[{scoreId:'S1',item:'项目团队与现场条件',score:10,elements:[{id:'E1',name:'人员进场计划',mustHave:'人员到场节点'},{id:'E2',name:'培训与考核',mustHave:'培训对象与频次'},{id:'E3',name:'现场临时用电',mustHave:'现场用电容量'},{id:'E4',name:'类似项目经历',mustHave:'类似项目及合同资料'}]},{scoreId:'S2',item:'质量措施',score:5,elements:[{id:'E1',name:'质量流程',mustHave:'检查流程'}]}];
 const elements=blueprint.map(g=>({scoreId:g.scoreId,item:g.item,rows:g.elements.map(e=>({elementId:e.id,name:e.name,approach:'依据实际方案执行',params:e.id==='E3'?'〔待确认：现场临时用电容量〕；〔待确认：主要施工机械型号〕':e.name==='质量流程'?'〔待确认：段落数〕':'',owner:'项目负责人',frequency:'按实际计划执行',confidence:'low'}))}));
 const sections=[{scoreId:'S1',title:'项目团队与现场条件',blocks:[{type:'p',text:'现场临时用电容量为〔待确认：现场临时用电容量〕。拟投入机械型号为〔待确认：主要施工机械型号〕。',covers:['E3']},{type:'p',text:'这是用户已精修的现场说明，请保留。',covers:[]}]},{scoreId:'S2',title:'质量措施',blocks:[{type:'p',text:'这是另一章的人工精修内容。',covers:['E1']}]}];
 for(const s of sections){s.plain=s.blocks.map(b=>b.text).join('\n');s.wordCount=s.plain.replace(/\s/g,'').length;}
 store.updateTender(t.id,{parse:{project:{},qualifications:[],scores:blueprint.map(g=>({id:g.scoreId,item:g.item})),outline:{}},blueprint,elements,sections,status:'generated'});return t;
}
async function putSupplements(t,groups,revision=t.revision){
 await ready;const r=await fetch(base+`/v1/tenders/${t.id}/supplements`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision,groups})});return {status:r.status,...await r.json()};
}

test('三个固定分组恢复原字段，无演示数据，不把段落计数变成用户问题', async()=>{
 const t=supplementFixture();const s=require('../src/supplements'),groups=s.getGroups(t);
 assert.deepEqual(groups.map(g=>g.id),['F1','F2','F3']);
 assert.equal(groups.find(g=>g.id==='F2').entries[0].fields.find(f=>f.key==='vendor').label,'供应商进场时间');
 // 入场计划固定三项；各岗位到场时间与备注不再单独提问（动态问题另计）
 const f2keys=groups.find(g=>g.id==='F2').entries[0].fields.filter(f=>f.type!=='label').map(f=>f.key);
 assert.deepEqual(f2keys.slice(0,3),['vendor','peak','source']);
 assert.ok(!f2keys.some(k=>['pm','tech','safe','spec'].includes(k)),'不应再有岗位到场字段');
 assert.equal(groups.find(g=>g.id==='F3').aiPolish,true);
 assert.ok(groups.every(g=>g.entries.every(e=>e.fields.every(f=>!f.value))));
 assert.ok(!groups.find(g=>g.id==='F2').entries[0].fields.some(f=>f.type==='textarea'),'F2 不再把正文占位符转成填写框');
 assert.ok(!groups.some(g=>g.fields.some(f=>/段落数/.test(f.label||''))));
 const detail=await request(`/v1/tenders/${t.id}/supplements`);
 assert.equal(detail.status,200);assert.equal(detail.data.stats.filled,0);assert.equal(detail.data.hasSections,true);
});

test('岗位到场时间不再单独提问，统一由供应商进场时间回答', async()=>{
 const t=supplementFixture();
 t.sections[0].blocks.push({type:'p',text:'项目经理到场时间按〔待确认：项目经理进场时间〕安排。',covers:['E1']});
 t.sections[0].plain=t.sections[0].blocks.map(b=>b.text).join('\n');
 const s=require('../src/supplements'),groups=s.getGroups(t);
 const f2=groups.find(g=>g.id==='F2');
 assert.ok(!f2.entries[0].fields.some(f=>/项目经理|技术负责人|安全员|特种作业/.test(f.label||'')),'不应新增岗位到场问题');
 const vendor=f2.entries[0].fields.find(f=>f.key==='vendor');
 assert.ok(vendor.markers.some(m=>m.marker==='项目经理进场时间'),'岗位到场标记应并入供应商进场时间');
 vendor.value='开工前5日';
 const res=await putSupplements(t,groups);assert.equal(res.status,200);
 assert.match(t.sections[0].plain,/项目经理到场时间按开工前5日安排/);
});

test('补充真实信息就地更新、持久化、重复保存不重复插入，并保留其他正文',async()=>{
 const t=supplementFixture();
 t.sections[0].blocks.unshift({type:'p',text:'项目经理到场时间按〔待确认：项目经理进场时间〕安排。',covers:['E1']});
 t.sections[0].plain=t.sections[0].blocks.map(b=>b.text).join('\n');
 const s=require('../src/supplements');const groups=s.getGroups(t);
 const field=(id,key)=>groups.find(g=>g.id===id).entries[0].fields.find(f=>f.key===key);
 field('F2','vendor').value='开工前5日';
 field('F3','subject').value='现场作业人员';field('F3','content').value='施工安全与工艺要求';
 
 const untouched=JSON.stringify(t.sections[1].blocks),manual=t.sections[0].blocks[2].text,oldRevision=t.revision;
 let res=await putSupplements(t,groups);assert.equal(res.status,200);
 assert.match(t.sections[0].plain,/项目经理到场时间按开工前5日安排/);assert.match(t.sections[0].plain,/开工前5日进场/);assert.match(t.sections[0].plain,/施工安全与工艺要求/);
 assert.equal(t.sections[0].blocks[2].text,manual);assert.equal(JSON.stringify(t.sections[1].blocks),untouched);
 assert.equal(store.listJobsByTender(t.id).length,0,'补充信息保存不应重新生成整份正文');
 assert.equal((await putSupplements(t,groups,oldRevision)).status,409);
 res=await putSupplements(t,s.getGroups(t));assert.equal(res.status,200);
 assert.equal(t.sections[0].blocks.filter(b=>b.supplementGroupId==='F2').length,1);
 const updated=s.getGroups(t);updated.find(g=>g.id==='F2').entries[0].fields.find(f=>f.key==='vendor').value='开工前3日';
 res=await putSupplements(t,updated);assert.equal(res.status,200);assert.match(t.sections[0].plain,/开工前3日安排/);
 assert.ok(t.sections[0].blocks[0].text.includes('开工前3日'));assert.ok(!t.sections[0].blocks[0].text.includes('开工前5日'));
 const disk=JSON.parse(fs.readFileSync(path.join(tmp,'db.json'),'utf8'));assert.ok(disk.tenders[t.id].supplementValues.length);
});

test('补充段落被人工精修后不覆盖，声明缺失保留警告且不清除强制占位符',async()=>{
 const t=supplementFixture(),s=require('../src/supplements');let groups=s.getGroups(t);
 groups.find(g=>g.id==='F2').entries[0].fields.find(f=>f.key==='vendor').value='开工前5日';
 await putSupplements(t,groups);
 const block=t.sections[0].blocks.find(b=>b.supplementGroupId==='F2');block.text='用户精修过的进场计划：请保留这段话。';
 groups=s.getGroups(t);groups.find(g=>g.id==='F2').entries[0].fields.find(f=>f.key==='vendor').value='开工前3日';
 const result=await putSupplements(t,groups);assert.equal(result.status,200);assert.ok(result.data.warnings.length>0);
 assert.ok(t.sections[0].blocks.some(b=>b.text==='用户精修过的进场计划：请保留这段话。'));
 groups=s.getGroups(t);groups.find(g=>g.id==='F1').declared=true;
 await putSupplements(t,groups);
 assert.ok(t.check.items.some(i=>i.id==='SUP-F1'&&i.level==='warn'));
 assert.ok(t.check.items.some(i=>i.cat==='placeholder'&&i.level==='block'));
});

test('待补页恢复条目增删与原字段，保存不触发全量生成',async()=>{
 const vm=require('node:vm'),s=require('../src/supplements'),t=supplementFixture();let cfg,putCalls=0,redirect;
 const api={action:async(p,fn)=>fn(),path:()=>'/v1/tenders/test',refresh:async()=>t,request:async(url,method)=>{if(method==='PUT'){putCalls++;return {revision:t.revision,warnings:[]};}return {revision:t.revision,groups:s.getGroups(t),stats:s.stats(s.getGroups(t)),hasSections:true};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/fill/fill.js'),'utf8'),{require:()=>api,Page:p=>cfg=p,wx:{redirectTo:o=>redirect=o.url}});
 const page={...cfg,data:JSON.parse(JSON.stringify(cfg.data)),setData(patch){for(const[k,v]of Object.entries(patch)){const keys=k.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;for(const key of keys.slice(0,-1))obj=obj[key];obj[keys.at(-1)]=v;}}};
 await page.onShow();assert.ok(page.data.groups.find(g=>g.id==='F2'));
 const e={currentTarget:{dataset:{id:'F1'}}};page.addEntry(e);assert.equal(page.data.groups.find(g=>g.id==='F1').entries.length,2);
 const id=page.data.groups.find(g=>g.id==='F1').entries[1].id;page.removeEntry({currentTarget:{dataset:{g:'F1',e:id}}});assert.equal(page.data.groups.find(g=>g.id==='F1').entries.length,1);
 await page.save();assert.equal(putCalls,1);assert.equal(redirect,'/pages/chapter/chapter');
});


test('培训建议可生成但不会自动保存为已实施事实，未知字段拒绝保存',async()=>{
 const t=supplementFixture(),s=require('../src/supplements');
 const draft=await request(`/v1/tenders/${t.id}/supplements/training-draft`,{});
 assert.equal(draft.status,200);assert.equal(draft.data.items.length,2);assert.match(draft.data.notice,/建议/);assert.equal(t.supplementValues,undefined);
 const groups=s.getGroups(t);groups[0].entries[0].fields.push({key:'unknown',value:'test'});
 assert.equal((await putSupplements(t,groups)).status,400);
});

test('计划类占位符归 AI 写实，不阻塞为用户待补',()=>{
 const check=require('../src/rules/check');
 const mk=(marker)=>({name:'x',sections:[{scoreId:'S1',title:'A',plain:`内容〔待确认：${marker}〕。`,blocks:[{type:'p',text:`内容〔待确认：${marker}〕。`}],wordCount:10}],parse:{qualifications:[],scores:[]},elements:[],blueprint:[]});
 for(const marker of ['具体设备清单及数量','具体供应商及人员入场计划','现场移交条件及水电接入情况','以进场后实测为准']){
  const ph=check.checkAll(mk(marker)).items.filter(i=>i.cat==='placeholder');
  assert.ok(ph.some(i=>i.id==='C5-A'&&i.fixType==='auto'),marker+' 应归入 AI 可自动修复');
  assert.ok(!ph.some(i=>i.id==='C5'),marker+' 不应要求用户填写');
 }
 // 硬事实仍然要用户给，不能被顺手改成 AI 编造
 const fact=check.checkAll(mk('类似项目业绩')).items.filter(i=>i.cat==='placeholder');
 assert.ok(fact.some(i=>i.id==='C5'&&i.fixType==='manual'),'业绩类仍需用户提供');
});

test('已保存真实信息在后续正文生成时继续织入',async()=>{
 const t=supplementFixture(),s=require('../src/supplements');const groups=s.getGroups(t);
 groups.find(g=>g.id==='F2').entries[0].fields.find(f=>f.key==='vendor').value='开工前5日';
 await putSupplements(t,groups);
 const fresh={...t,sections:[{scoreId:'S1',title:'重新生成的初稿',blocks:[{type:'p',text:'项目经理到场时间按〔待确认：项目经理进场时间〕安排。',covers:['E3']}]}]};
 const applied=s.applyToSections(fresh,undefined,true);assert.match(applied.sections[0].plain,/开工前5日/);
 const reordered={...t,blueprint:[...t.blueprint].reverse()};
 assert.equal(s.getGroups(reordered).find(g=>g.id==='F2').fields.find(f=>f.key==='vendor').key,'vendor');
});

test('三项补充固定保留，新的招标文件未提关键词也不隐藏项目经历',()=>{
 const s=require('../src/supplements');const groups=s.getGroups({parse:{project:{sector:'老旧小区'}},blueprint:[{scoreId:'X',item:'设计方案',elements:[{id:'E1',name:'设计说明',mustHave:'设计内容'}]}]});
 assert.deepEqual(groups.map(g=>g.id),['F1','F2','F3']);assert.equal(groups[0].repeat,true);assert.equal(groups[2].repeat,true);assert.equal(groups[2].aiPolish,true);
 assert.ok(groups[0].entries[0].fields.some(f=>f.key==='amount'));
});
test('完整评分章节保留相邻表格与原页码，拒绝0分和混入资信业绩',()=>{
 const {scoringSections,validateScores,validateGroup}=require('../src/pipeline/validation');
 const source=[{no:'第二章',title:'须知',text:''},{no:'第三章',title:'评标办法',text:''},{no:'2.2',title:'分值',page:53,text:'承包人建议书：34分；承包人实施方案：22分；资信业绩部分：14分'},{no:'2.2',title:'4',page:54,text:'设计方案6分'},{no:'第四章',title:'合同',text:''}];
 assert.equal(scoringSections(source).length,3);assert.equal(scoringSections(source)[2].page,54);
 assert.match(validateScores({items:[{id:'T',score:0,tierDesc:''}]},source),/正分值/);
 assert.match(validateScores({items:[{id:'T',score:70,tierDesc:'标准'}]},source),/56/);
 assert.equal(validateScores({items:[{id:'T',score:56,tierDesc:'标准'}]},source),null);
 assert.match(validateGroup({items:[{scoreId:'wrong',blocks:[]}]},{scoreId:'X',rows:[]},'blocks'),/当前评分项/);
});
test('一键优化更新实际正文再自检，保护真实占位符，失败不改变原文',async()=>{
 const t=supplementFixture(),writing=require('../src/writing'),old=llm.runUnit;
 t.sections=[writing.recalc({scoreId:'S1',title:'项目团队与现场条件',blocks:[{type:'p',text:'保留：〔待确认：现场临时用电容量〕。流程：〔待确认：工作步骤数〕。',covers:['E3']}]})];
 const before=t.sections[0].plain;let called=0;
 try{
  llm.runUnit=async spec=>{called++;const next={items:[{scoreId:'S1',title:t.sections[0].title,blocks:[{type:'p',text:'保留：〔待确认：现场临时用电容量〕。拟按交底、检查、整改、复核实施管理，项目技术负责人组织检查。',covers:['E1','E2','E3','E4']}]}]};assert.equal(spec.validateData(next),null);return {data:next,degraded:false};};
  const start=await request(`/v1/tenders/${t.id}/repair`,{});assert.equal(start.status,200);
  for(let i=0;i<100&&['queued','running'].includes(store.getJob(start.data.jobId).status);i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(store.getJob(start.data.jobId).status,'done');assert.ok(called>0);assert.notEqual(t.sections[0].plain,before);assert.match(t.sections[0].plain,/现场临时用电容量/);assert.doesNotMatch(t.sections[0].plain,/工作步骤数/);
  assert.ok(!t.check.items.some(i=>i.id==='C5-A'));assert.ok(t.check.items.some(i=>i.id==='C5'&&i.level==='block'));assert.equal(t.documentHistory.at(-1).sections[0].plain,before);
  const saved=JSON.stringify(t.sections),job=store.createJob(t.id,'chapter',1);store.updateJob(job.id,{options:{action:'polish',scoreId:'S1'}});llm.runUnit=async()=>{throw Error('模拟不可用');};
  await assert.rejects(writing.run(job.id,t,'chapter'),/不可用/);assert.equal(JSON.stringify(t.sections),saved);store.updateJob(job.id,{status:'failed'});
 }finally{llm.runUnit=old;}
});
test('修复与自检口径一致：非用户事实的占位符不清零就不算修完',async()=>{
 const t=supplementFixture(),writing=require('../src/writing'),old=llm.runUnit;
 // 「施工部署」既不是用户事实，也不匹配 isWritingTask 关键词；
 // 自检会把它算成 C5-A 阻断，所以修复校验必须同样拦住，否则会出现「优化完阻断数不变」。
 t.sections=[writing.recalc({scoreId:'S1',title:'项目团队与现场条件',blocks:[{type:'p',text:'按〔待确认：施工部署〕组织施工。',covers:['E3']}]})];
 let seen=null;
 try{
  llm.runUnit=async spec=>{
   const stale={items:[{scoreId:'S1',title:'项目团队与现场条件',blocks:[{type:'p',text:'按〔待确认：施工部署〕组织施工。',covers:['E1','E2','E3','E4']}]}]};
   seen=spec.validateData(stale);
   throw Error('模型未修完');
  };
  const job=store.createJob(t.id,'repair',1);store.updateJob(job.id,{options:{issueId:'C5-A'}});
  await assert.rejects(writing.run(job.id,t,'repair'),/没有修完/);
  assert.ok(seen&&/施工部署/.test(seen),'残留的写作类占位符必须被校验拦下并指名');
 }finally{llm.runUnit=old;}
});

test('章节配图表写入真实表格，导出 Word 包含同样的表格内容',async()=>{
 const t=supplementFixture(),writing=require('../src/writing'),old=llm.runUnit;
 try{
  llm.runUnit=async spec=>{const data={items:[{scoreId:'S2',title:'质量措施',blocks:[{type:'p',text:'由责任岗位按计划检查与复核。',covers:['E1']},{type:'table',text:'拟实施检查表',covers:[],rows:[['环节','责任岗位'],['检查','质量负责人'],['复核','技术负责人']]}]}]};assert.equal(spec.validateData(data),null);return {data};};
  const job=store.createJob(t.id,'chapter',1);store.updateJob(job.id,{options:{action:'chart',scoreId:'S2'}});const untouched=JSON.stringify(t.sections[0]);await writing.run(job.id,t,'chapter');store.updateJob(job.id,{status:'done'});
  assert.equal(JSON.stringify(t.sections[0]),untouched);assert.equal(t.sections[1].blocks.at(-1).type,'table');
  const buffer=await require('../src/export').buildDocx(t,true),zip=await require('jszip').loadAsync(buffer),xml=await zip.file('word/document.xml').async('string');assert.match(xml,/<w:tbl>/);assert.match(xml,/质量负责人/);
 }finally{llm.runUnit=old;}
});

test('原导出设置真实作用于 Word 与 PDF，中文与表格均可读取',async()=>{
 const t=supplementFixture(),opts=require('../src/export-options').exportOptions(new URLSearchParams('font=黑体&size=14&line=28&toc=1&header=1'));
 t.check=require('../src/rules/check').checkAll(t);
 const docx=await require('../src/export').buildDocx(t,true,opts),zip=await require('jszip').loadAsync(docx);
 assert.match(await zip.file('word/styles.xml').async('string'),/w:eastAsia="黑体"/);assert.match(await zip.file('word/styles.xml').async('string'),/w:line="560" w:lineRule="exact"/);
 assert.ok(zip.file('word/header1.xml'));assert.ok(zip.file('word/footer1.xml'));assert.match(await zip.file('word/document.xml').async('string'),/ TOC /);
 const pdf=await require('../src/export-pdf').buildPdf(t,true,opts);assert.equal(pdf.subarray(0,4).toString(),'%PDF');const parsed=await require('pdf-parse')(Uint8Array.from(pdf),{version:'v2.0.550'});assert.equal(parsed.numpages,3,'页眉页脚不能额外生成空白页');assert.match(parsed.text,/测试草稿/);assert.match(parsed.text,/现场临时用电容量/);
 assert.throws(()=>require('../src/export-options').exportOptions(new URLSearchParams('size=200')),/无效排版/);
 await ready;const response=await fetch(base+`/v1/tenders/${t.id}/export?draft=1&format=pdf&font=${encodeURIComponent('仿宋')}&size=12&line=22`);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);
});

test('PDF 跨行封面项目名称不会误取标段名称残片',()=>{
 const {extractName}=require('../src/project-name');const doc={pages:[{page:1,text:'I\n十堰市茅箭区客运站片区老旧小区改造项目（项目名称）十\n堰市茅箭区客运站片区（一期）老旧小区改造EPC项目（标\n段名称）工程总承包招标\n招标文件'}]};assert.equal(extractName(doc).name,'十堰市茅箭区客运站片区（一期）老旧小区改造EPC项目');
});

test('正文已由 AI 解决的问题不再从旧要素底稿重复要求用户补充',()=>{
 const s=require('../src/supplements'),t=supplementFixture();t.sections[0].blocks[0].text='现场条件已有核定资料，按实施方案分区组织。';t.sections[0]=require('../src/writing').recalc(t.sections[0]);
 const groups=s.getGroups(t);assert.equal(groups.length,3);assert.ok(!groups.flatMap(g=>g.fields).some(f=>f.marker==='现场临时用电容量'));
});

test('项目要素页面显示实际抽取值，原文未明确与未识别分开，合格性总数不等于技术响应数',()=>{
 const vm=require('node:vm'),module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module,exports:module.exports});
 const p={name:'实际工程',purchaser:'实际招标人',budget:'1140.70万元（合同估算价）',deadline:'2024-05-28 09:00',bidNo:'HBSY-015001001',evalMethod:'综合评估法',quality:'设计合格；施工合格',pageLimit:'',fieldStatus:{pageLimit:'not_specified'},fieldEvidence:{budget:{section:'招标范围',page:7,quote:'合同估算价：1140.70万元'}}};
 const v=module.exports.view({name:'实际工程',parse:{project:p,qualifications:[{no:'Q1',cat:'qual',resp:'attach',text:'须提供资质证明',confidence:'high'}],scores:[],outline:{}}});
 assert.equal(v.project.purchaser,p.purchaser);assert.equal(v.project.budget,p.budget);assert.equal(v.project.deadline,p.deadline);assert.equal(v.project.bidNo,p.bidNo);assert.equal(v.project.quality,p.quality);assert.equal(v.project.pageLimit,'原文未明确');assert.equal(v.project.blind,'尚未识别');assert.equal(v.qualStats.total,1);assert.equal(v.qualStats.tech,0);assert.equal(v.techRisks.length,1);assert.match(v.fieldDetails.find(f=>f.key==='budget').source,/P7/);
});
test('原文上下文保留标题里的截止时间、相邻质量条款及完整响应性表',()=>{
 const a=require('../src/pipeline/analysis');const source=[{no:'第一章',title:'招标公告',page:1,text:'招标人为甲方建设中心'},{no:'2.1',title:'建设地点',page:2,text:'建设地点：城北片区'},{no:'5.1',title:'投标文件递交截止时间为：2024年05月28日09时00分',page:3,text:''},{no:'1.3.3',title:'质量标准',page:4,text:'设计要求的质量标准：合格\n施工要求的质量标准：合格'},{no:'第三章',title:'评标办法',page:6,text:''},{no:'2.1.3',title:'响应性评审标准',page:7,text:'工期符合第二章第1.3.2项规定\n质量标准符合第二章第1.3.3项规定\n承包人建议符合第五章发包人要求'},{no:'第四章',title:'合同',page:8,text:''}];
 assert.match(a.projectContext(source),/2024年05月28日09时00分/);assert.match(a.projectContext(source),/设计要求的质量标准/);assert.match(a.qualificationContext(source),/承包人建议符合/);
 assert.match(a.validateQualifications({items:[{resp:'attach',text:'营业执照'}]},source),/工期/);assert.equal(a.validateQualifications({items:[{resp:'tech',text:'工期、质量、承包人建议按发包人要求响应'}]},source),null);
});
test('有明确原文的字段不允许留空，抽取证据必须可定位，未说明字段可以为空',()=>{
 const a=require('../src/pipeline/analysis'),source=[{no:'1',title:'项目概况',page:7,text:'合同估算价：1140.70万元'}];
 assert.match(a.validateProject({},source),/预算或合同估算价/);
 assert.match(a.validateProject({budget:'1140.70万元',fieldEvidence:{budget:{page:7,quote:'虚构的原文'}}},source),/原文证据/);
 assert.equal(a.validateProject({budget:'1140.70万元',fieldEvidence:{budget:{section:'项目概况',page:7,quote:'合同估算价：1140.70万元'}}},source),null);
 assert.equal(a.finishProject({budget:'1140.70万元'},source).fieldStatus.pageLimit,'not_specified');
});

function missingChapterFixture(missing=['10']){
 const t=store.createTender({name:'缺章修复隔离用例'});
 const blueprint=['9','10','11'].map(scoreId=>({scoreId,item:scoreId==='10'?'项目施工实施要点':'已完成章节'+scoreId,score:5,tierDesc:'按要点评分',keywords:[],elements:Array.from({length:scoreId==='10'?4:2},(_,i)=>({id:'E'+(i+1),name:'实施要点'+(i+1),mustHave:'具体做法与控制步骤'}))}));
 const elements=blueprint.map(require('../src/pipeline/baseline').elementTable);
 const sections=blueprint.filter(g=>!missing.includes(g.scoreId)).map(g=>require('../src/writing').recalc({scoreId:g.scoreId,title:g.item,edited:true,blocks:[{type:'p',text:'人工精修内容'+g.scoreId+'，应完整保留。',covers:g.elements.map(e=>e.id)}]}));
 store.updateTender(t.id,{blueprint,elements,sections,parse:{project:{name:t.name},qualifications:[],scores:blueprint.map(g=>({id:g.scoreId,item:g.item,score:5})),outline:{}},status:'generated',supplementValues:['F1','F2','F3'].map(id=>({id,declared:true,entries:[{id:id+'-1',values:{}}]}))});return t;
}
async function awaitJob(jobId){for(let i=0;i<200;i++){const j=store.getJob(jobId);if(j.status==='failed'||j.status==='done')return j;await new Promise(r=>setTimeout(r,10));}assert.fail('任务未完成');}
function completedSectionData(t,id){const bp=t.blueprint.find(b=>b.scoreId===id);return {items:[{scoreId:id,title:bp.item,blocks:[{type:'p',text:'项目技术负责人组织交底，按工序检查，发现问题整改并复核留存记录。',covers:bp.elements.map(e=>e.id)}]}]};}
test('真实缺章形态：C2-10 按评分项补章并放回原顺序，其他人工正文完全保留',async()=>{
 const t=missingChapterFixture(),old=llm.runUnit,untouched=JSON.stringify(t.sections);let calls=0;
 const before=require('../src/rules/check').checkAll(t),issue=before.items.find(i=>i.id==='C2-10');assert.equal(issue.missingSection,true);assert.equal(issue.scoreId,'10');assert.equal(issue.elementIds.length,4);
 try{llm.runUnit=async spec=>{calls++;const payload=JSON.parse(spec.user);assert.equal(payload.original.scoreId,'10');assert.equal(payload.original.blocks.length,0);const data=completedSectionData(t,'10');assert.equal(spec.validateData(data),null);return {data};};
  assert.equal((await fetch(base+`/v1/tenders/${t.id}/export`)).status,409);
  const started=await request(`/v1/tenders/${t.id}/repair`,{issueId:'C2-10'});assert.equal(started.status,200);const job=await awaitJob(started.data.jobId);
  assert.equal(job.status,'done',job.error);assert.equal(job.result.created,1);assert.equal(calls,1);assert.deepEqual(t.sections.map(s=>s.scoreId),['9','10','11']);assert.equal(JSON.stringify(t.sections.filter(s=>s.scoreId!=='10')),untouched);assert.equal(job.items[0].action,'create');assert.ok(!t.check.items.some(i=>i.id==='C2-10'));assert.equal(t.check.blocking,0);assert.equal((await fetch(base+`/v1/tenders/${t.id}/export`)).status,200);
 }finally{llm.runUnit=old;}
});
test('所有正文尚未生成也可按施工图补写，API 不再要求已有章节',async()=>{
 const t=missingChapterFixture(['9','10','11']),old=llm.runUnit;
 try{llm.runUnit=async spec=>{const id=JSON.parse(spec.user).original.scoreId;const data=completedSectionData(t,id);assert.equal(spec.validateData(data),null);return {data};};const started=await request(`/v1/tenders/${t.id}/repair`,{});assert.equal(started.status,200);const job=await awaitJob(started.data.jobId);assert.equal(job.status,'done',job.error);assert.equal(job.result.created,3);assert.equal(t.sections.length,3);assert.equal(t.check.blocking,0);}finally{llm.runUnit=old;}
});
test('缺章同时缺要素表时先补要素表，再写正文，只保存同章成功结果',async()=>{
 const t=missingChapterFixture(),old=llm.runUnit;t.elements=t.elements.filter(g=>g.scoreId!=='10');const phases=[];
 try{llm.runUnit=async spec=>{phases.push(spec.name);const data=spec.name==='修复前补齐要素表'?{items:[require('../src/pipeline/baseline').elementTable(t.blueprint[1])]}:completedSectionData(t,'10');assert.equal(spec.validateData(data),null);return {data};};const started=await request(`/v1/tenders/${t.id}/repair`,{issueId:'C2-10'});const job=await awaitJob(started.data.jobId);assert.equal(job.status,'done',job.error);assert.deepEqual(phases,['修复前补齐要素表','章节 AI 修复']);assert.equal(t.elements.find(g=>g.scoreId==='10').rows.length,4);assert.equal(t.sections.length,3);}finally{llm.runUnit=old;}
});
test('缺章补写失败不留下空章、不改变原文和版本，仍保留阻断',async()=>{
 const t=missingChapterFixture(),old=llm.runUnit,before=JSON.stringify(t.sections),revision=t.revision;
 try{llm.runUnit=async()=>{throw Error('模拟模型不可用');};const started=await request(`/v1/tenders/${t.id}/repair`,{issueId:'C2-10'});const job=await awaitJob(started.data.jobId);assert.equal(job.status,'failed');assert.match(job.error,/项目施工实施要点/);assert.equal(JSON.stringify(t.sections),before);assert.equal(t.revision,revision);assert.ok(require('../src/rules/check').checkAll(t).items.some(i=>i.id==='C2-10'));}finally{llm.runUnit=old;}
});
test('多章修复先失败一章仍继续后面的章节，部分成功真实回写，失败项可重试',async()=>{
 const t=missingChapterFixture(['10','11']),old=llm.runUnit,calls=[];let fail=true;
 try{llm.runUnit=async spec=>{const id=JSON.parse(spec.user).original.scoreId;calls.push(id);if(id==='10'&&fail)throw Error('模拟单章失败');return {data:completedSectionData(t,id)};};let started=await request(`/v1/tenders/${t.id}/repair`,{});let job=await awaitJob(started.data.jobId);assert.equal(job.status,'done',job.error);assert.deepEqual(calls,['10','11']);assert.equal(job.result.changed,1);assert.equal(job.result.failed.length,1);assert.ok(t.check.items.some(i=>i.id==='C2-10'));assert.ok(!t.check.items.some(i=>i.id==='C2-11'));const good=JSON.stringify(t.sections);fail=false;started=await request(`/v1/tenders/${t.id}/repair`,{});job=await awaitJob(started.data.jobId);assert.equal(job.status,'done');assert.equal(calls.at(-1),'10');assert.equal(JSON.stringify(t.sections.filter(s=>s.scoreId!=='10')),good);assert.equal(t.check.blocking,0);}finally{llm.runUnit=old;}
});
test('生成重试只处理缺失章节，保留已完成章节及人工修改',async()=>{
 const t=missingChapterFixture(),old=llm.runUnit,before=JSON.stringify(t.sections);let calls=0;
 try{llm.runUnit=async spec=>{calls++;const data=completedSectionData(t,'10');assert.equal(spec.validateData(data),null);return {data};};const started=await request(`/v1/tenders/${t.id}/generate`,{retryFailed:true});const job=await awaitJob(started.data.jobId);assert.equal(job.status,'done',job.error);assert.equal(calls,1);assert.equal(JSON.stringify(t.sections.filter(s=>s.scoreId!=='10')),before);assert.deepEqual(t.sections.map(s=>s.scoreId),['9','10','11']);}finally{llm.runUnit=old;}
});
test('生成页不会将部分正文当作完成或自动跳转，并显示仅重试缺章的提示',async()=>{
 const vm=require('node:vm'),t=missingChapterFixture(),serviceModule={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module:serviceModule,exports:serviceModule.exports});const real=serviceModule.exports;assert.equal(real.stageReady(t,'sections'),false);assert.equal(real.stageReady(t,'elements'),true);
 let cfg,redirects=0;const stages=[];const api={action:async(p,fn)=>fn(),refresh:async()=>t,generationChapters:()=>[],stageReady:real.stageReady,ensure:async name=>{stages.push(name);return t;}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/generating/generating.js'),'utf8'),{Page:p=>cfg=p,require:()=>api,wx:{redirectTo:()=>redirects++},setTimeout:()=>{redirects++;}});const page={...cfg,data:JSON.parse(JSON.stringify(cfg.data)),setData(p){Object.assign(this.data,p);}};await page.start();assert.deepEqual(stages,['elements','generate']);assert.equal(redirects,0);assert.match(page.data.error,/项目施工实施要点/);assert.match(page.data.error,/仅补写失败章节/);assert.ok(page.data.percent<100);assert.equal(page.data.stage,2);
});

test('生成部分失败会保留可重试状态，不伪装成全部内容完成',async()=>{
 const t=missingChapterFixture(['9','10','11']),old=llm.runUnit;let call=0;
 try{llm.runUnit=async spec=>{const id=['9','10','11'][call++];if(id==='10')throw Error('模拟该章生成失败');return {data:completedSectionData(t,id)};};const started=await request(`/v1/tenders/${t.id}/generate`,{});const job=await awaitJob(started.data.jobId);assert.equal(job.status,'done');assert.match(job.label,/部分完成/);assert.equal(job.result.failed,1);assert.equal(t.generateMeta.failed[0].scoreId,'10');assert.equal(t.sections.length,2);assert.equal(job.items[1].status,'failed');assert.ok(t.check.items.some(i=>i.id==='C2-10'));}finally{llm.runUnit=old;}
});
test('自检优化失败提示补写未完成及重试方法，不误导为仅剩用户事实',async()=>{
 const vm=require('node:vm');let cfg,message='';const check={blocking:1,warning:0,auto:1,items:[{id:'C2-10',cat:'cover',level:'block',fixType:'auto',title:'缺章',count:4}]};const api={action:async(p,fn)=>{try{await fn();}catch(e){message=e.message;}},refresh:async()=>({}),check:async()=>JSON.parse(JSON.stringify(check)),stage:async()=>{throw Error('模型暂时不可用');}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/check/check.js'),'utf8'),{require:()=>api,Page:p=>cfg=p,wx:{showModal(){}}});const page={...cfg,data:{...JSON.parse(JSON.stringify(cfg.data)),check},setData(p){Object.assign(this.data,p);}};await page.optimize('C2-10');assert.match(message,/对应章节尚未补写完成/);assert.match(message,/重试本项 AI 优化/);assert.match(message,/模型暂时不可用/);assert.equal(page.data.optimizing,false);assert.equal(page.data.check.blocking,1);
});

test('部分生成在列表与阶段标识中显示真实完成比例，标题不能冒充正文',async()=>{
 const t=missingChapterFixture();const detail=(await request(`/v1/tenders/${t.id}`)).data;assert.equal(detail.stages.sections,false);assert.equal(detail.generation.completed,2);assert.equal(detail.generation.total,3);
 const vm=require('node:vm'),module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module,exports:module.exports});const item=module.exports.listItem({...detail,createdAt:'2026-11-01',updatedAt:'2026-11-01'});assert.equal(item.statusText,'部分章节未完成');assert.equal(item.progress,67);
 t.sections.push(require('../src/writing').recalc({scoreId:'10',title:'项目施工实施要点',blocks:[{type:'h4',text:'只有标题',covers:['E1','E2','E3','E4']}]}));const check=require('../src/rules/check').checkAll(t);assert.ok(check.items.some(i=>i.id==='C0'));assert.ok(check.items.some(i=>i.id==='C2-10'));
});

test('长表格按原顺序拆成续表，所有数据保留，每张表符合接口行数限制',()=>{
 const {normalizeSections}=require('../src/pipeline/normalize-sections'),Ajv=require('ajv'),schema=require('../src/pipeline/units').SCHEMAS.sections;
 const rows=[['环节','做法'],...Array.from({length:28},(_,i)=>['环节'+i,'具体做法'+i])];const data={items:[{scoreId:'10',title:'实施要点',blocks:[{type:'table',text:'实施清单',covers:['E1'],rows}]}]};normalizeSections(data,['E1']);const tables=data.items[0].blocks;assert.equal(tables.length,3);assert.deepEqual(tables.flatMap(t=>t.rows.slice(1)),rows.slice(1));assert.ok(tables.every(t=>t.rows.length<=12));assert.equal(new Ajv({strict:false}).compile(schema)(data),true);
});
test('缺少 covers 的段落只继承明确的标题关联，嵌套 rows 正文展开为扁平块',()=>{
 const {normalizeSections}=require('../src/pipeline/normalize-sections');const data={items:[{scoreId:'10',title:'实施要点',blocks:[{type:'h4',text:'实施工序',covers:['E1'],rows:[{type:'p',text:'按交底、检查、整改和复核组织实施。'}]},{type:'p',text:'未显式写 covers 的后续实施方法。'}]}]};normalizeSections(data,['E1']);assert.equal(data.items[0].blocks.length,3);assert.ok(!Object.hasOwn(data.items[0].blocks[0],'rows'));assert.deepEqual(data.items[0].blocks[1].covers,['E1']);assert.deepEqual(data.items[0].blocks[2].covers,['E1']);
 const unknown={items:[{blocks:[{type:'p',text:'没有可继承的关联信息。'}]}]};normalizeSections(unknown,['E1']);assert.deepEqual(unknown.items[0].blocks[0].covers,[]);
});
test('结构整理在 Schema 校验前执行，避免有效内容仅因表格格式而整章失败',async()=>{
 const {normalizeSections}=require('../src/pipeline/normalize-sections');const result=await llm.runUnit({name:'表格结构兼容回归',schema:require('../src/pipeline/units').SCHEMAS.sections,prepare:d=>normalizeSections(d,['E1']),fallback:async()=>({items:[{scoreId:'10',title:'实施要点',blocks:[{type:'h4',text:'实施清单',covers:['E1']},{type:'table',text:'检查要点',rows:[['工序','检查动作'],...Array.from({length:15},(_,i)=>['工序'+i,'按要求复核并记录'])]}]}]})});assert.equal(result.data.items[0].blocks.filter(b=>b.type==='table').length,2);assert.ok(result.data.items[0].blocks.every(b=>Array.isArray(b.covers)));
});
test('结构整理不猜填缺失单元格，不吞掉错误格式，表格中的写作占位符仍被拦截',()=>{
 const {normalizeSections}=require('../src/pipeline/normalize-sections'),{validateGroup}=require('../src/pipeline/validation');assert.throws(()=>normalizeSections({items:[{blocks:[{type:'table',text:'错误表格',rows:[['a','b'],['只有一列']]}]}]},[]),/列数不一致/);
 const data={items:[{scoreId:'10',blocks:[{type:'table',text:'实施清单',covers:['E1'],rows:[['环节','做法'],['检查','〔待确认：检查频次〕']]}]}]};normalizeSections(data,['E1']);assert.match(validateGroup(data,{scoreId:'10',rows:[{elementId:'E1'}]},'blocks'),/检查频次/);
});

test('真实资料保存同步替换要素、正文及表格；声明无此项清除对应标记但保留强制条款',async()=>{
 const s=require('../src/supplements'),t=supplementFixture();
 t.elements[0].rows[3].params='〔待确认：类似项目经历〕';
 t.sections[0].blocks=[{type:'table',text:'真实资料',covers:['E1','E2','E3','E4'],rows:[['项目','内容'],['经历','〔待确认：类似项目经历〕'],['日期','〔待确认：合同签订日期〕'],['进场','〔待确认：项目经理进场时间〕']]},{type:'p',text:'保留人工说明',covers:[]}];
 t.sections[0].plain='旧缓存〔待确认：类似项目经历〕';
 t.parse.qualifications=[{no:'4.1',text:'必须逐条响应4.1条款',resp:'tech'}];
 let groups=s.getGroups(t),f=key=>groups[0].entries[0].fields.find(x=>x.key===key);
 f('name').value='真实工程甲';f('type').value='建筑工程';f('signDate').value='2024-06';f('amount').value='120';f('status').value='已完成';groups[1].entries[0].fields.find(x=>x.key==='vendor').value='开工前5日';
 assert.equal((await putSupplements(t,groups)).status,200);
 assert.match(t.sections[0].blocks[0].rows[1][1],/真实工程甲/);assert.equal(t.sections[0].blocks[0].rows[2][1],'2024-06');assert.match(t.elements[0].rows[3].params,/真实工程甲/);
 assert.ok(!t.check.items.some(x=>x.id==='C5'&&x.level==='block'));
 assert.ok(t.check.items.some(x=>x.id==='C1'&&x.level==='block'),'不得绕过招标强制条款');
 groups=s.getGroups(t);groups[0].declared=true;assert.equal((await putSupplements(t,groups)).status,200);
 assert.equal(t.sections[0].blocks[0].rows[1][1],'未提供（已人工确认）');assert.equal(t.sections[0].blocks[0].rows[2][1],'未提供（已人工确认）');
 assert.ok(!t.check.items.some(x=>x.id==='C5'&&x.level==='block'));assert.ok(t.check.items.some(x=>x.id==='SUP-F1'&&x.level==='warn'));assert.equal(t.sections[0].blocks[1].text,'保留人工说明');
});
test('正文专属真实资料可从待确认入口填写，就地更新且拒绝过期版本与伪字段',async()=>{
 const t=supplementFixture(),facts=require('../src/pending-facts');
 t.sections[0].blocks.push({type:'table',text:'查勘资料',covers:[],rows:[['内容','实测值'],['供电','〔待确认：现场临时用电容量〕']]});
 const before=JSON.stringify(t.sections[1]);assert.ok(facts.list(t).some(x=>x.marker==='现场临时用电容量'));assert.ok(!facts.list(t).some(x=>x.marker==='段落数'));
 await ready;const send=async body=>{const r=await fetch(base+`/v1/tenders/${t.id}/pending-facts`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 const revision=t.revision;
 assert.equal((await send({revision,values:[{marker:'不存在的事实',value:'x'}]})).status,400);
 assert.equal((await send({revision,values:[{marker:'现场临时用电容量',value:'250kVA'}]})).status,200);
 assert.match(t.sections[0].plain,/250kVA/);assert.equal(t.sections[0].blocks.at(-1).rows[1][1],'250kVA');assert.match(t.elements[0].rows[2].params,/250kVA/);assert.equal(JSON.stringify(t.sections[1]),before);
 assert.ok(!t.check.items.find(x=>x.id==='C5')?.samples.includes('现场临时用电容量'));assert.equal((await send({revision,values:[{marker:'现场临时用电容量',value:'300kVA'}]})).status,409);assert.equal(store.listJobsByTender(t.id).length,0);
});
test('章节增删改排序同步关联内容、归档误识别项，新章节只补缺失内容',async()=>{
 const t=supplementFixture(),untouched=JSON.stringify(t.sections[1].blocks);let revision=t.revision;
 const edit=body=>request(`/v1/tenders/${t.id}/chapters`,{revision:t.revision,...body});
 let r=await edit({action:'rename',scoreId:'S2',title:'人工质量管理'});assert.equal(r.status,200);assert.equal(t.blueprint[1].item,'人工质量管理');assert.equal(t.sections[1].title,'人工质量管理');assert.equal(t.elements[1].item,'人工质量管理');
 assert.equal((await request(`/v1/tenders/${t.id}/chapters`,{revision,action:'remove',scoreId:'S2'})).status,409);
 assert.equal((await edit({action:'move',scoreId:'S2',index:0})).status,200);assert.equal(t.sections[0].scoreId,'S2');assert.equal(t.parse.scores[0].id,'S2');
 r=await edit({action:'add',title:'人工补充技术措施'});assert.equal(r.status,200);const added=r.data.scoreId;assert.ok(t.blueprint.some(g=>g.scoreId===added));assert.equal(t.sections.length,2);
 await request(`/v1/tenders/${t.id}/elements`,{retryFailed:true});for(let i=0;i<200;i++){if(!store.listJobsByTender(t.id).some(j=>j.status==='running'||j.status==='queued'))break;await new Promise(resolve=>setTimeout(resolve,10));}
 await request(`/v1/tenders/${t.id}/generate`,{retryFailed:true});for(let i=0;i<200;i++){if(!store.listJobsByTender(t.id).some(j=>j.status==='running'||j.status==='queued'))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.ok(t.sections.some(g=>g.scoreId===added));assert.equal(JSON.stringify(t.sections.find(g=>g.scoreId==='S2').blocks),untouched);assert.ok(!t.check?.items.some(x=>x.id==='C-SCORE'&&x.samples?.some(s=>s.includes('人工补充'))));
 assert.equal((await edit({action:'remove',scoreId:'S1'})).status,200);for(const key of ['blueprint','elements','sections'])assert.ok(!t[key].some(g=>g.scoreId==='S1'));assert.ok(t.parse.excludedScores.some(g=>g.id==='S1'));assert.ok(t.chapterHistory.some(h=>h.removed?.section));
 await edit({action:'remove',scoreId:added});assert.equal((await edit({action:'remove',scoreId:'S2'})).status,400);assert.equal(t.sections[0].scoreId,'S2');
});

test('资料齐全或三组均声明无此项，相关阻断确实归零；不会仅清界面计数',async()=>{
 const supplements=require('../src/supplements');
 for(const declared of [false,true]){
  const t=supplementFixture();t.parse.scores.forEach(s=>s.score=s.id==='S1'?10:5);
  t.sections[0].blocks=[{type:'p',text:'经历〔待确认：类似项目经历〕；人员到场〔待确认：项目经理进场时间〕；培训对象〔待确认：培训对象〕。',covers:['E1','E2','E3','E4']}];
  t.sections[0].plain=t.sections[0].blocks[0].text;
  const groups=supplements.getGroups(t);
  for(const g of groups){g.declared=declared;if(!declared)for(const f of g.entries[0].fields)f.value=f.key==='status'?'已完成':f.key==='amount'?'120':f.key==='signDate'?'2024-06':'已经核实的真实资料';}
  assert.equal((await putSupplements(t,groups)).status,200);
  assert.equal(t.check.blocking,0,JSON.stringify(t.check.items.filter(i=>i.level==='block')));assert.equal(t.check.gate.canExport,true);assert.doesNotMatch(t.sections[0].plain,/〔待确认/);
  const recheck=await request(`/v1/tenders/${t.id}/check`,{});assert.equal(recheck.data.blocking,0);assert.equal(recheck.data.gate.canExport,true);
 }
});
