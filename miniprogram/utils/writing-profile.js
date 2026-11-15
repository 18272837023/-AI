'use strict';
// 前后端共用篇幅规划；估算不等于 Word 实际页数。
function profile(title){
 const overview=/工程概况|项目概况|编制依据|项目基本/.test(title||'');
 const technical=/施工方案|专项|技术方案|工艺|重点|难点|质量|安全|应急|服务方案/.test(title||'');
 return overview?{kind:'overview',low:600,high:900,min:400,blocks:3}:technical?{kind:'technical',low:1800,high:2600,min:1400,blocks:6}:{kind:'standard',low:1000,high:1600,min:800,blocks:4};
}
function pageLimit(project={}){const value=String(project.pageLimit||'').trim(),m=/(\d+)\s*页/.exec(value)||/^([1-9]\d*)$/.exec(value);return m?Number(m[1]):null;}
function chapterRows(chapters){return (chapters||[]).map(c=>({scoreId:String(c.scoreId??c.id),title:c.item||c.name||c.title||'',count:c.elementCount??c.elements?.length??c.rows?.length??0,score:Math.max(0,Number(c.score)||0)})).filter(c=>c.count>0);}
function documentPlan(chapters,project={}){
 const rows=chapterRows(chapters),natural=rows.map(c=>profile(c.title).high*c.count),sum=natural.reduce((n,x)=>n+x,0),scores=rows.reduce((n,c)=>n+c.score,0),pages=pageLimit(project),budget=pages?Math.floor(pages*420*.85):sum;
 // 同时考虑技术复杂度、要素数量和评分权重。无评分的人工章节仍有基本篇幅。
 const weights=rows.map((c,i)=>scores?natural[i]*.65+sum*(c.score/scores)*.35:natural[i]),weight=weights.reduce((n,x)=>n+x,0),available=Math.min(sum,budget);
 return rows.map((c,i)=>{const p=profile(c.title),high=Math.floor(available*(weights[i]/(weight||1))/c.count),low=Math.floor(high*p.low/p.high);return {...c,perElementHigh:high,perElementLow:low,minPerElement:Math.floor(high*p.min/p.high),minBlocks:high>=p.high*.8?p.blocks:high>=900?4:high>=400?3:high>=200?2:1,kind:p.kind,constrained:pages!=null&&budget<sum,pageLimit:pages,low:low*c.count,high:high*c.count};});
}
function planFor(title,count,context={}){
 const p=profile(title),pages=pageLimit(context.project),portfolio=documentPlan(context.chapters,context.project),row=portfolio.find(c=>context.scoreId!=null?c.scoreId===String(context.scoreId):c.title===title);
 if(row)return {...row,version:3};
 let high=p.high,constrained=false;const total=Math.max(count,Number(context.totalElements)||count||1);
 if(pages){const budget=Math.floor(pages*420*.85/total);if(budget<high){high=budget;constrained=true;}}
 const low=Math.floor(high*p.low/p.high),min=Math.floor(high*p.min/p.high);
 return {version:3,kind:p.kind,perElementLow:low,perElementHigh:high,minPerElement:min,minBlocks:high>=p.high*.8?p.blocks:high>=900?4:high>=400?3:high>=200?2:1,low:low*count,high:high*count,constrained,pageLimit:pages};
}
module.exports={planFor,documentPlan,pageLimit};
