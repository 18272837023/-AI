'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(name,api,wx={}){let config;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages',name,name+'.js'),'utf8'),{require:()=>api,Page:p=>config=p,wx});return {...config,data:JSON.parse(JSON.stringify(config.data||{})),setData(patch){for(const [key,value] of Object.entries(patch)){const keys=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;for(const part of keys.slice(0,-1))obj=obj[part];obj[keys.at(-1)]=value;}}};}
test('待补资料集中展示真实参数，已绑定固定字段不重复提问，输入后保留表单并缓存草稿',async()=>{
 const t={revision:3,pendingFacts:[{marker:'现场临时用电容量',chapters:['现场条件']},{marker:'人员来源',chapters:['施工安排']}]};let draft;
 const group={id:'F2',fields:[{key:'source',markers:[{marker:'人员来源'}]}],entries:[{id:'F2-1',fields:[{key:'source',value:'',required:true}]}]};
 const api={action:async(p,fn)=>fn(),refresh:async()=>t,path:()=>'/t',request:async()=>({revision:3,groups:[group],stats:{groups:1},hasSections:true}),ensure:()=>assert.fail('待补资料不能生成要素表')};
 const wx={setStorageSync:(k,v)=>draft=v};const page=load('fill',api,wx);await page.onShow();assert.equal(page.data.facts.length,1);assert.equal(page.data.facts[0].marker,'现场临时用电容量');assert.equal(page.data.totalFields,2);assert.equal(page.data.pendingCount,2);
 page.onFactInput({currentTarget:{dataset:{id:'fact-0'}},detail:{value:'250kVA'}});assert.equal(page.data.pendingCount,1);assert.equal(page.data.facts[0].value,'250kVA');assert.equal(draft.facts[0].value,'250kVA');
 const restored=load('fill',api,{getStorageSync:()=>draft});await restored.onShow();assert.equal(restored.data.facts[0].value,'250kVA');
});
test('保存集中真实资料使用最新版本同步原文，不重写编写数据或重新生成正文',async()=>{
 let t={revision:2,pendingFacts:[{marker:'现场用电容量',chapters:['现场条件']}],sections:[{scoreId:'S1'}]},writes=[];let redirect;
 const api={action:async(p,fn)=>fn(),refresh:async()=>t,path:()=>'/t',save:async()=>assert.fail('不应保存编写数据'),stage:async()=>assert.fail('不应重生成正文'),request:async(url,method,b)=>{if(!method)return {revision:t.revision,groups:[],stats:{groups:0},hasSections:true};writes.push(url);assert.equal(b.revision,t.revision);t={...t,revision:t.revision+1};if(url.endsWith('/pending-facts')){assert.equal(b.values[0].value,'250kVA');t.pendingFacts=[];}return {revision:t.revision,groups:[],warnings:[]};}};
 const page=load('fill',api,{redirectTo:o=>redirect=o.url});await page.onShow();page.onFactInput({currentTarget:{dataset:{id:'fact-0'}},detail:{value:'250kVA'}});await page.save();assert.deepEqual(writes,['/t/supplements','/t/pending-facts']);assert.equal(page.data.facts.length,0);assert.equal(redirect,'/pages/chapter/chapter');
});
test('确认无此项立即保存，失败恢复选择，成功使用新版本号',async()=>{
 let reject=false,writes=0;const g={id:'F1',canDeclare:true,declared:false,entries:[{id:'F1-1',fields:[]}]};
 const api={action:async(p,fn)=>fn(),path:()=>'/t',request:async(url,method,body)=>{writes++;if(reject)throw Error('save failed');return {revision:4,groups:JSON.parse(JSON.stringify(body.groups))};}};
 const page=load('fill',api,{showModal:o=>o.success({confirm:true}),showToast(){}});page.data.groups=[g];page._revision=3;
 await page.declare({currentTarget:{dataset:{id:'F1'}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);assert.equal(page._revision,4);assert.equal(page.data.groups[0].declared,true);
 reject=true;await assert.rejects(page.declare({currentTarget:{dataset:{id:'F1'}}}),/save failed/);assert.equal(page.data.groups[0].declared,true);
});
test('正文分片失败后保留项目，开始解析重试上传，不重复创建项目',async()=>{
 let creates=0,uploads=0,entered=false;
 const api={action:async(p,fn)=>fn(),create:async()=>{creates++;return {id:'T1'};},upload:async()=>{uploads++;if(uploads===1)throw Error('上传文件分片失败');},refresh:async id=>{assert.equal(id,'T1');},session:{tender:{revision:1}}};
 const page=load('create',api,{navigateTo:()=>entered=true});await assert.rejects(page.prepareFile({path:'x',name:'招标文件.pdf',size:1480000}),/分片失败/);assert.equal(page._draftId,'T1');assert.equal(page._mainUploaded,false);assert.match(page.data.nameStatus,/重试/);
 await page.startParse();assert.equal(creates,1);assert.equal(uploads,2);assert.equal(entered,true);
});
test('人工新增章节无评分分值仍可确认大纲，真实评分缺失仍引导核对',()=>{
 let url;const page=load('outline',{}, {navigateTo:o=>url=o.url});page.data.outline=[{id:'S1',score:10},{id:'manual',score:0,custom:true}];page.startGenerate();assert.equal(url,'/pages/generating/generating');page.data.outline[1].custom=false;page.startGenerate();assert.equal(url,'/pages/analysis/analysis');
});
