'use strict';
function exportOptions(query){
 const get=k=>typeof query.get==='function'?query.get(k):query[k];
 const font=get('font')||'宋体',size=Number(get('size')||12),line=get('line')||'22';
 if(!['宋体','黑体','仿宋'].includes(font)||![10.5,12,14].includes(size)||!['1.5','22','28'].includes(line))throw Object.assign(Error('无效排版设置'),{statusCode:400});
 return {font,size,line,autoToc:get('toc')!=='0',headerFooter:get('header')!=='0',blindMode:get('blind')!=='0'};
}
module.exports={exportOptions};
