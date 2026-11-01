'use strict';
// 只整理可确定的结构，不删正文、不截断表格，也不凭空关联要素。
function normalizeSections(data,ids){
 const valid=new Set(ids);
 function covers(value,fallback=[]){
  const source=value===undefined?fallback:typeof value==='string'?[value]:value;
  if(!Array.isArray(source))throw Error('covers 应是要素 ID 数组');
  return [...new Set(source.map(id=>{const text=String(id);if(valid.has(text))return text;const found=/\bE\d+\b/i.exec(text);return found&&valid.has(found[0].toUpperCase())?found[0].toUpperCase():text;}))];
 }
 function cell(v){if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return String(v);throw Error('表格单元格必须是文字，不能嵌套正文块');}
 function table(b){
  let rows=b.rows;
  if(!Array.isArray(rows)||rows.length<2)throw Error('表格至少需要表头和一行内容');
  if(rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&!r.type)){
   const keys=Object.keys(rows[0]);if(rows.some(r=>Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))))throw Error('表格各行字段不一致');
   rows=[keys,...rows.map(r=>keys.map(k=>cell(r[k])))];
  } else rows=rows.map(r=>{if(!Array.isArray(r))throw Error('表格 rows 必须为二维数组');return r.map(cell);});
  const width=rows[0].length;if(width<2||rows.some(r=>r.length!==width))throw Error('表格各行列数不一致');
  const columnGroups=width<=6?[rows]:Array.from({length:Math.ceil((width-1)/5)},(_,i)=>rows.map(r=>[r[0],...r.slice(1+i*5,1+(i+1)*5)]));
  const result=[];
  for(const columns of columnGroups)for(let start=1;start<columns.length;start+=11)result.push({...b,type:'table',text:result.length?`${b.text}（续${result.length+1}）`:b.text,rows:[columns[0],...columns.slice(start,start+11)]});
  return result;
 }
 function walk(blocks,inherited=[],depth=0){
  if(!Array.isArray(blocks)||depth>6)throw Error('章节内容不是有效的正文块数组');
  const result=[];let active=inherited;
  for(const source of blocks){
   if(!source||!['h4','p','table'].includes(source.type))throw Error('正文块类型无效');
   const b={...source,covers:covers(source.covers,source.type==='h4'?[]:active)};
   if(b.type==='h4')active=b.covers;
   if(b.type==='table'){result.push(...table(b));continue;}
   if(b.rows!==undefined){
    const rows=b.rows;delete b.rows;result.push(b);
    if(Array.isArray(rows)&&rows.every(r=>r&&['h4','p','table'].includes(r.type)))result.push(...walk(rows,b.covers,depth+1));
    else if(Array.isArray(rows)&&rows.every(Array.isArray))result.push(...table({...b,type:'table',rows}));
    else throw Error('非表格正文携带无法识别的 rows，请使用扁平 blocks 数组');
   } else result.push(b);
  }
  return result;
 }
 for(const section of data.items||[])section.blocks=walk(section.blocks);
 return data;
}
module.exports={normalizeSections};
