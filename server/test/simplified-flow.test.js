'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const realModule={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/utils/service.js'),'utf8'),{module:realModule,require:id=>require(path.join(__dirname,'../../miniprogram/utils',id))});const real=realModule.exports;
function page(name,api,wx={},extra={}){let cfg;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages',name,name+'.js'),'utf8'),{Page:p=>cfg=p,require:()=>api,wx,...extra});return {...cfg,data:JSON.parse(JSON.stringify(cfg.data||{})),setData(p){for(const [key,value] of Object.entries(p)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let o=this.data;for(const k of parts.slice(0,-1))o=o[k];o[parts.at(-1)]=value;}}};}
const run={action:async(p,fn)=>fn()};
test('确认解析结果准备内部大纲后直接进入大纲页，旧入口自动迁移',async()=>{
 const stages=[],routes=[],api={...run,ensure:async(name,field)=>{stages.push([name,field]);return {};}};
 const p=page('analysis',api,{navigateTo:o=>routes.push(o.url)});p.data.project.techScore=45;await p.confirm();assert.deepEqual(stages,[['blueprint','blueprint']]);assert.deepEqual(routes,['/pages/outline/outline']);
 for(const [old,destination] of [['blueprint','/pages/outline/outline'],['elements','/pages/fill/fill?facts=1']]){let url;page(old,{}, {redirectTo:o=>url=o.url}).onLoad();assert.equal(url,destination);}
});
test('一键生成自动准备内部内容并写正文，完成后直接进入正文，不要求表单确认',async()=>{
 let t={parse:{project:{},scores:[{id:'A',item:'服务方案',score:10}]},blueprint:[{scoreId:'A',item:'服务方案',elements:[{id:'E1',name:'服务流程'}]}]},stages=[],timers=[],url;const snapshots=[];
 const api={...run,refresh:async()=>t,generationChapters:real.generationChapters,stageReady:real.stageReady,ensure:async(stage,field,progress)=>{stages.push(stage);progress({stage,status:'running',progress:30,label:stage==='elements'?'填要素表：服务方案':'正在生成正文',step:1,items:[{scoreId:'A',status:'running'}]});if(field==='elements')t={...t,elements:[{scoreId:'A',rows:[{elementId:'E1',approach:'执行流程'}]}]};else t={...t,sections:[{scoreId:'A',title:'服务方案',blocks:[{type:'p',text:'具体实施流程',covers:['E1']}],wordCount:6}]};return t;}};
 const p=page('generating',api,{redirectTo:o=>url=o.url},{setTimeout:fn=>{timers.push(fn);return 1;}}),set=p.setData.bind(p);p.setData=data=>{set(data);snapshots.push(JSON.stringify(data));};await p.start();assert.deepEqual(stages,['elements','generate']);assert.equal(p.data.percent,100);assert.ok(!snapshots.some(s=>s.includes('要素表')));timers[0]();assert.equal(url,'/pages/chapter/chapter');
});
test('保存资料的第二次请求失败时保留输入与新版本，重试可完成，不重新生成正文',async()=>{
 let t={revision:1,pendingFacts:[{marker:'现场用电容量',chapters:['现场条件']}],sections:[{scoreId:'A'}]},fail=true,draft,redirect;
 const api={...run,refresh:async()=>t,path:()=>'/t',stage:()=>assert.fail('不能重新生成正文'),request:async(url,method,body)=>{if(!method)return {revision:t.revision,groups:[],stats:{},hasSections:true};assert.equal(body.revision,t.revision);if(url.endsWith('/pending-facts')&&fail)throw Error('保存超时');t={...t,revision:t.revision+1,...(url.endsWith('/pending-facts')?{pendingFacts:[]}:{})};return {revision:t.revision,groups:[],warnings:[]};}};
 const p=page('fill',api,{setStorageSync:(k,v)=>draft=v,redirectTo:o=>redirect=o.url});await p.onShow();p.onFactInput({currentTarget:{dataset:{id:'fact-0'}},detail:{value:'250kVA'}});await assert.rejects(p.save(),/保存超时/);assert.equal(p.data.facts[0].value,'250kVA');assert.equal(draft.revision,2);assert.equal(p._revision,2);fail=false;await p.save();assert.equal(p.data.facts.length,0);assert.equal(redirect,'/pages/chapter/chapter');
});
