'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../../miniprogram/pages/export/export.js'),'utf8');
function load(api,wx={}){let cfg;vm.runInNewContext(source,{Page:p=>cfg=p,require:()=>api,wx});const page={...cfg,data:JSON.parse(JSON.stringify(cfg.data)),options:{from:'chapter',id:'T1'}};page.setData=p=>Object.assign(page.data,p);return page;}
for(const format of ['word','pdf'])test('微信页面内置 options 为对象时仍能导出 '+format+'，正确传递排版选项',async()=>{
 let call,toast;const api={action:async(p,fn)=>fn(),download:async(draft,options)=>{call={draft,options:JSON.parse(JSON.stringify(options))};}};
 const page=load(api,{showToast:o=>toast=o.title});page.setData({fontIndex:2,sizeIndex:2,lineIndex:2,autoToc:false,headerFooter:false,blindMode:true,format});
 assert.equal(typeof page.options,'object');await page.download();assert.deepEqual(call,{draft:false,options:{font:'仿宋',size:14,line:'28',toc:'0',header:'0',blind:'1',format}});assert.equal(toast,'文档已下载');assert.equal(page.options.from,'chapter');
});
test('重新进入导出页恢复保存的设置，导航参数不影响导出参数的构建',async()=>{
 let sent,stored;const saved={fontIndex:1,sizeIndex:0,lineIndex:0,autoToc:true,headerFooter:true,blindMode:false,format:'pdf'};
 const api={action:async(p,fn)=>fn(),refresh:async()=>({id:'T1',name:'实际工程',sections:[{wordCount:200}]}),check:async()=>({blocking:0,warning:2,passed:5,gate:{title:'可以导出',desc:'还有提醒'}}),download:async(draft,options)=>sent=JSON.parse(JSON.stringify(options))};
 const page=load(api,{getStorageSync:key=>{assert.equal(key,'export-options-T1');return saved;},setStorageSync:(key,value)=>stored={key,value},showToast(){}});page.onShow();await new Promise(resolve=>setImmediate(resolve));await page.download();assert.deepEqual(sent,{font:'黑体',size:10.5,line:'1.5',toc:'1',header:'1',blind:'0',format:'pdf'});assert.equal(page.data.warning,2);page.pickFormat({currentTarget:{dataset:{key:'word'}}});assert.equal(stored.key,'export-options-T1');assert.equal(stored.value.format,'word');
});
test('下载失败显示原始失败原因，不提示下载成功，处理状态正确释放',async()=>{
 let toast=false;const api={action:async(p,fn)=>{if(p._busy)return;p._busy=true;try{return await fn();}finally{p._busy=false;}},download:async()=>{throw Error('云端导出文件未生成');}};
 const page=load(api,{showToast:()=>toast=true});await assert.rejects(page.download(),/云端导出文件未生成/);assert.equal(toast,false);assert.equal(page._busy,false);
});
