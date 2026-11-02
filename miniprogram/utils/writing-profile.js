'use strict';
// 前后端共用估算口径；页数约束下的字数仅用于写作预算，最终需核对导出排版。
function planFor(title,count,context={}){
 const overview=/工程概况|项目概况|编制依据|项目基本/.test(title||'');
 const technical=/施工方案|专项|技术方案|工艺|重点|难点|质量|安全|应急|服务方案/.test(title||'');
 let low=overview?250:technical?550:400,high=overview?450:technical?900:700,min=overview?160:technical?330:240;
 const value=String(context.project?.pageLimit||'').trim(),match=/(\d+)\s*页/.exec(value)||/^([1-9]\d*)$/.exec(value);
 const pages=match?Number(match[1]):null,total=Math.max(count,Number(context.totalElements)||count||1);
 let constrained=false;
 if(pages>0){const budget=Math.floor(pages*420*.85/total);if(budget<high){high=Math.max(12,budget);low=Math.max(8,Math.min(low,Math.floor(high*.75)));min=Math.max(6,Math.min(min,Math.floor(low*.6)));constrained=true;}}
 return {version:2,kind:overview?'overview':technical?'technical':'standard',perElementLow:low,perElementHigh:high,minPerElement:min,minBlocks:high>=300?2:1,low:low*count,high:high*count,constrained,pageLimit:pages};
}
module.exports={planFor};
