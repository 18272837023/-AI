'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(name,api,wx={}){let cfg;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages',name,name+'.js'),'utf8'),{Page:p=>cfg=p,require:()=>api,wx});return {...cfg,data:JSON.parse(JSON.stringify(cfg.data)),setData(p){Object.assign(this.data,p);}};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const action=async(p,fn)=>{if(p._busy)return;p._busy=true;p.setData({busy:true});try{return await fn();}finally{p._busy=false;p.setData({busy:false});}};
const tender=()=>({id:'T1',revision:1,updatedAt:'2026-11-04T12:00:00',name:'服务项目',sections:[{scoreId:'A',title:'实施方案',wordCount:200,blocks:[{type:'p',text:'原正文'}]}]});
for(const operation of ['expand','polish'])test('章节'+operation+'全程显示加载、禁止重复提交，成功后刷新正文和字数',async()=>{
 const job=deferred(),t=tender();let callback,calls=0,toast;
 const api={action,session:{tender:t,chapter:0},view:()=>({scoreItems:[]}),refresh:async()=>api.session.tender,stage:(name,cb,p,payload)=>{assert.equal(name,'chapter-ai');assert.equal(payload.action,operation);callback=cb;calls++;return job.promise;}};
 const p=load('chapter',api,{setNavigationBarTitle(){},showToast:o=>toast=o.title});await p.onShow();const running=p.aiAction({currentTarget:{dataset:{key:operation}}});assert.equal(p.data.aiWorking,true);assert.match(p.data.aiTitle,operation==='expand'?/扩写/:/润色/);assert.equal(p.data.aiHasProgress,false);
 await p.aiAction({currentTarget:{dataset:{key:operation}}});assert.equal(calls,1);p.toggleEdit();assert.equal(p.data.editing,false);callback({progress:64,label:'正在补充实施流程'});assert.equal(p.data.aiProgress,64);assert.equal(p.data.aiLabel,'正在补充实施流程');
 const updated={...t,revision:2,sections:[{...t.sections[0],wordCount:1200,blocks:[{type:'p',text:'更充分的实施方案'}]}]};api.session.tender=updated;job.resolve(updated);await running;
 assert.equal(p.data.aiWorking,false);assert.equal(p._busy,false);assert.equal(p._revision,2);assert.equal(p.data.chapter.wordCount,1200);assert.equal(p.data.chapter.blocks[0].text,'更充分的实施方案');assert.equal(toast,'正文已更新');
});
test('章节任务失败退出加载态且保留原文，可再次提交',async()=>{
 const t=tender(),api={action,session:{tender:t,chapter:0},view:()=>({scoreItems:[]}),refresh:async()=>t,stage:async()=>{throw Error('生成超时');}};
 const p=load('chapter',api,{setNavigationBarTitle(){}});await p.onShow();await assert.rejects(p.aiAction({currentTarget:{dataset:{key:'expand'}}}),/生成超时/);assert.equal(p.data.aiWorking,false);assert.equal(p._busy,false);assert.equal(p.data.chapter.blocks[0].text,'原正文');
});
test('全稿扩写保持加载直到篇幅刷新，自动返回导出页并刷新预览、保留排版选项',async()=>{
 const job=deferred(),planRefresh=deferred();let t=tender(),requests=0,callback,backs=0,jobs=0;
 const api={action,path:()=>'/t',request:async()=>++requests===1?{addWords:800}:planRefresh.promise,stage:(name,cb)=>{assert.equal(name,'expand');jobs++;callback=cb;return job.promise;},refresh:async()=>t,check:async()=>({blocking:0,warning:0,passed:1,gate:{title:'可以导出',desc:''}})};
 const preview=load('export',api,{getStorageSync:()=>({fontIndex:2,format:'pdf'})});await preview.onShow();assert.equal(preview.data.wordCount,200);
 const p=load('expand',api,{showToast(){},navigateBack:o=>{assert.equal(o.delta,1);backs++;}});p.onLoad({from:'export'});p.data.targetPages='30';const running=p.start();assert.equal(p.data.expanding,true);await tick();await p.start();assert.equal(jobs,1);callback({status:'running',progress:55,label:'正在扩写实施方案'});assert.equal(p.data.progress,55);
 t={...t,revision:2,sections:[{...t.sections[0],wordCount:1400},{scoreId:'B',wordCount:500}]};callback({status:'done',progress:100,result:{failed:[]}});job.resolve(t);await tick();assert.equal(p.data.expanding,true);assert.equal(backs,0);assert.match(p.data.label,/刷新/);planRefresh.resolve({addWords:0,currentWords:1900});await running;
 assert.equal(p.data.expanding,false);assert.equal(backs,1);await preview.onShow();assert.equal(preview.data.chapterCount,2);assert.equal(preview.data.wordCount,1900);assert.equal(preview.data.fontIndex,2);assert.equal(preview.data.format,'pdf');assert.equal(preview.data.previewLoading,false);
});
for(const failure of ['partial','refresh','job'])test('全稿扩写'+failure+'失败时退出加载并保留可处理的结果',async()=>{
 let requests=0,backs=0;const api={action,path:()=>'/t',request:async()=>{requests++;if(failure==='refresh'&&requests>1)throw Error('刷新超时');return {addWords:500};},stage:async(name,cb)=>{if(failure==='job')throw Error('扩写超时');cb({status:'done',progress:100,result:{failed:failure==='partial'?[{title:'实施方案',error:'章节超时'}]:[]}});return tender();}};
 const p=load('expand',api,{navigateBack:()=>backs++,showToast(){}});p.onLoad({from:'export'});p.data.targetPages='30';if(failure==='job'){await assert.rejects(p.start(),/扩写超时/);assert.equal(p.data.error,'扩写超时');}else {await p.start();if(failure==='partial')assert.match(p.data.result,/实施方案：章节超时/);else {assert.match(p.data.refreshError,/已保存/);assert.equal(p.data.plan,null);assert.doesNotMatch(p.data.result,/字数已更新/);}}
 assert.equal(p.data.expanding,false);assert.equal(p._busy,false);assert.equal(backs,0);p.goChapter();assert.equal(backs,1);
});
test('导出页预览刷新失败也会退出加载，扩写入口防止重复导航',async()=>{
 let complete,calls=0;const p=load('export',{action,refresh:async()=>{throw Error('读取超时');}},{navigateTo:o=>{calls++;assert.match(o.url,/from=export/);complete=o.complete;}});await assert.rejects(p.onShow(),/读取超时/);assert.equal(p.data.previewLoading,false);p.goExpand();assert.equal(p.data.navigating,true);p.goExpand();assert.equal(calls,1);complete();assert.equal(p.data.navigating,false);
});
