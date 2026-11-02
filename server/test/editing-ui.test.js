'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(name,api,wx={}){let config;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../miniprogram/pages',name,name+'.js'),'utf8'),{require:()=>api,Page:p=>config=p,wx});return {...config,data:JSON.parse(JSON.stringify(config.data)),setData(patch){for(const [key,value] of Object.entries(patch)){const keys=key.replace(/\[(\d+)\]/g,'.$1').split('.');let obj=this.data;for(const part of keys.slice(0,-1))obj=obj[part];obj[keys.at(-1)]=value;}}};}
test('待确认清单定位真实字段，筛选不丢失其他值，保存按ID关联而非列表位置',async()=>{
 const t={revision:3,elements:[{scoreId:'S2',item:'质量管理',rows:[{elementId:'E9',name:'材料检验',approach:'逐批检查',params:'〔待确认：现场临时用电容量〕',owner:'质量员',frequency:'每批次'}]},{scoreId:'S1',item:'施工安排',rows:[{elementId:'E1',name:'人员',approach:'进场交底',params:'20人',owner:'项目经理',frequency:''}]}],pendingFacts:[]};let selector,saved,redirect;
 const api={action:async(p,fn)=>fn(),ensure:async()=>t,save:async(k,v,revision)=>{assert.equal(revision,3);saved=v;},stage:async()=>{},path:()=>'/t'};
 const page=load('elements',api,{pageScrollTo:o=>selector=o.selector,showToast(){},redirectTo:o=>redirect=o.url});page.onLoad({pending:'1'});await page.onShow();assert.equal(page.data.pendingCount,2);assert.equal(page.data.filledCount,6);assert.equal(page.data.onlyPending,true);
 const link=page.data.pendingLinks[0];page.locatePending({currentTarget:{dataset:{anchor:link.anchor}}});assert.equal(selector,'#field-G0-R0-params');
 page.onInput({currentTarget:{dataset:{g:'G0',e:'R0',k:'params'}},detail:{value:'250kVA'}});assert.equal(page.data.pendingCount,1);assert.equal(page.data.groups[0].visiblePendingCount,1);assert.equal(page.data.groups[0].entries[0].fields[1].keepVisible,true,'输入中的字段不能因已填而立即消失');
 page.data.groups.reverse();await page.save();assert.equal(saved[0].rows[0].params,'250kVA');assert.equal(saved[0].rows[0].owner,'质量员');assert.equal(saved[1].rows[0].approach,'进场交底');assert.equal(redirect,'/pages/chapter/chapter');
});
test('正文真实资料保存同步更新要素后不重新生成已有正文',async()=>{
 let t={revision:2,elements:[{scoreId:'S1',item:'现场条件',rows:[{elementId:'E1',name:'电源',approach:'核对',params:'〔待确认：现场用电容量〕',owner:'电工',frequency:'每日'}]}],pendingFacts:[{marker:'现场用电容量',chapters:['现场条件']}],sections:[{scoreId:'S1'}]};let writes=0;
 const api={action:async(p,fn)=>fn(),ensure:async()=>t,refresh:async()=>t,path:()=>'/t',save:async()=>assert.fail('不应重写要素表'),stage:async()=>assert.fail('不应重生成正文'),request:async(url,method,b)=>{writes++;assert.equal(b.values[0].value,'250kVA');t=JSON.parse(JSON.stringify(t));t.revision=3;t.elements[0].rows[0].params='250kVA';t.pendingFacts=[];return {revision:3};}};
 const page=load('elements',api,{redirectTo(){}});await page.onShow();page.onFactInput({currentTarget:{dataset:{id:'fact-0'}},detail:{value:'250kVA'}});await page.save();assert.equal(writes,1);
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
 let url;const page=load('blueprint',{}, {navigateTo:o=>url=o.url});page.data.items=[{id:'S1',score:10},{id:'manual',score:0,custom:true}];page.confirm();assert.equal(url,'/pages/outline/outline');page.data.items[1].custom=false;page.confirm();assert.equal(url,'/pages/analysis/analysis');
});
