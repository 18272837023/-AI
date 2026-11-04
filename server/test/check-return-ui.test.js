'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function page(name,api,wx={}){let cfg;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages',name,name+'.js'),'utf8'),{Page:p=>cfg=p,require:()=>api,wx});return {...cfg,data:JSON.parse(JSON.stringify(cfg.data)),setData(p){for(const [key,value] of Object.entries(p)){const keys=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;for(const k of keys.slice(0,-1))obj=obj[k];obj[keys.at(-1)]=value;}}};}
const action=async(p,fn)=>{if(p._busy)return;p._busy=true;try{return await fn();}finally{p._busy=false;}};
const event=id=>({currentTarget:{dataset:{id}}});
for(const item of [{id:'C5',cat:'placeholder'},{id:'SUP-F1',cat:'supplement'}])test(item.id+'从自检进入填写页，保存后回到原自检页、刷新阻断并保留筛选',async()=>{
 let route,refreshed,back=0,checks=0,t={revision:1,sections:[{scoreId:'A'}],pendingFacts:[{marker:'现场用电容量',chapters:['现场条件']}]};
 const api={action,path:()=>'/t',refresh:async()=>t,check:async()=>{checks++;return {blocking:t.pendingFacts.length,warning:0,passed:t.pendingFacts.length?0:1,auto:0,items:[{...item,level:t.pendingFacts.length?'block':'pass',fixType:'manual'}]};},request:async(url,method,body)=>{if(!method)return {revision:t.revision,groups:[],stats:{},hasSections:true};assert.equal(body.revision,t.revision);if(url.endsWith('/pending-facts')){assert.equal(body.values[0].value,'250kVA');t.pendingFacts=[];}t.revision++;return {revision:t.revision,groups:[],warnings:[]};}};
 const check=page('check',api,{navigateTo:o=>route=o.url});await check.onShow();check.setFilter({currentTarget:{dataset:{key:'block'}}});check.primary(event(item.id));assert.equal(route,'/pages/fill/fill?from=check');
 const fill=page('fill',api,{navigateBack:o=>{assert.equal(o.delta,1);back++;refreshed=check.onShow();},redirectTo:()=>assert.fail('不能回退到正文或重复创建自检页')});fill.onLoad({from:'check'});await fill.onShow();fill.onFactInput({...event('fact-0'),detail:{value:'250kVA'}});await fill.save();await refreshed;
 assert.equal(back,1);assert.equal(checks,2);assert.equal(check.data.check.blocking,0);assert.equal(check.data.filter,'block');assert.equal(check.data.shown.length,0);assert.equal(fill.data.fromCheck,true);
});
test('保存有风险提醒时确认后才返回自检，返回失败以自检页兜底',async()=>{
 let modal,redirect,back=0;const api={action,path:()=>'/t',refresh:async()=>({revision:2,sections:[{}],pendingFacts:[]}),request:async()=>({revision:2,groups:[],warnings:['仍需核对强制要求']})};
 const fill=page('fill',api,{showModal:o=>modal=o,navigateBack:o=>{back++;o.fail();},redirectTo:o=>redirect=o.url});fill.onLoad({from:'check'});fill._revision=1;await fill.save();assert.equal(back,0);assert.match(modal.content,/强制要求/);modal.success({confirm:true});assert.equal(back,1);assert.equal(redirect,'/pages/check/check');
});
test('资料保存失败留在填写页，不跳回正文或自检，保留输入便于重试',async()=>{
 const api={action,path:()=>'/t',request:async()=>{throw Error('保存超时');}},fill=page('fill',api,{navigateBack:()=>assert.fail('失败不能跳转'),redirectTo:()=>assert.fail('失败不能跳转')});fill.onLoad({from:'check'});fill.data.facts=[{marker:'现场用电容量',value:'250kVA'}];await assert.rejects(fill.save(),/保存超时/);assert.equal(fill.data.facts[0].value,'250kVA');assert.equal(fill._busy,false);
});
test('AI 修复完成留在当前自检页，刷新结果与筛选，关闭提示不触发跳转',async()=>{
 let repaired=false,modal;const api={action,refresh:async()=>({}),check:async()=>({blocking:repaired?0:1,auto:repaired?0:1,warning:0,passed:repaired?1:0,items:[{id:'C5-A',cat:'placeholder',fixType:'auto',level:repaired?'pass':'block'}]}),stage:async(name,progress)=>{assert.equal(name,'repair');repaired=true;progress({progress:100,label:'修复完成'});}};
 const check=page('check',api,{navigateTo:()=>assert.fail('不能离开自检页'),navigateBack:()=>assert.fail('不能回退'),redirectTo:()=>assert.fail('不能跳转'),showModal:o=>modal=o});await check.onShow();check.setFilter({currentTarget:{dataset:{key:'block'}}});await check.primary(event('C5-A'));assert.equal(check.data.check.blocking,0);assert.equal(check.data.filter,'block');assert.equal(check.data.shown.length,0);assert.equal(check.data.lastRun.fixed,1);assert.equal(check.data.optimizing,false);assert.match(modal.title,/阻断降到 0 项/);assert.equal(modal.success,undefined);
});
