'use strict';
const numbered=text=>/^(?:第[一二三四五六七八九十百\d]+[章节]|\d+(?:\.\d+)*[、.．\s]|[一二三四五六七八九十]+[、．])/.test(text);
function clean(text){return String(text||'').replace(/^\s*#{1,6}\s*/, '').trim();}
function exportSections(t){return (t.sections||[]).map((section,index)=>{
 const title=clean(section.title),blocks=[];let sub=0,table=0;
 const source=section.blocks||[],group=(t.elements||[]).find(g=>String(g.scoreId)===String(section.scoreId));
 const seen=new Set(),hasHeadings=source.some(b=>b.type==='h4');
 for(const block of source){
  if(!hasHeadings&&block.type!=='h4')for(const id of block.covers||[]){if(seen.has(id))continue;seen.add(id);const row=group?.rows?.find(r=>r.elementId===id);if(row?.name)blocks.push({type:'h4',text:`${index+1}.${++sub} ${clean(row.name)}`,covers:[]});}
  let text=block.text;
  if(block.type==='h4'){text=clean(text);sub++;if(!numbered(text))text=`${index+1}.${sub} ${text}`;}
  if(block.type==='table'){text=clean(text);table++;if(!/^表\s*\d/.test(text))text=`表 ${index+1}-${table} ${text}`;}
  blocks.push({...block,text});
 }
 return {...section,title:numbered(title)?title:`${index+1} ${title}`,blocks};
});}
module.exports={exportSections};
