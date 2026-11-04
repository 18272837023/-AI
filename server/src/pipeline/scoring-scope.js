'use strict';
function category(text){
 const lead=String(text||'').split('|')[0].replace(/\s/g,'').replace(/^[\d一二三四五六七八九十、.．()（）]+/,'');
 if(/^(?:综合标|综合部分|综合评分|商务标|商务部分|商务分|资信(?:业绩)?(?:部分|标)?|价格部分|报价部分)(?=$|[（(\s|：:])/.test(lead))return 'other';
 if(/^(?:技术部分|技术标|技术方案|技术评分|承包人建议书|承包人实施方案)(?=$|[（(\s|：:])/.test(lead))return 'tech';
 return '';
}
function scopedLines(sections){let scope='';return sections.flatMap(s=>((s.no||'')+' '+(s.title||'')+'\n'+(s.text||'')).split(/\r?\n/).map(text=>{const heading=category(text);if(heading)scope=heading;return {text:text.trim(),s,scope,heading};}));}
const compact=s=>String(s||'').replace(/[\s|，,。:：()（）]/g,'');
function scopeError(rows,sections){
 const lines=scopedLines(sections);
 for(const row of rows){
  if(/综合标|商务标|商务评分|报价得分|企业(?:业绩|信誉|信用|资质)|财务状况|类似项目业绩/.test(row.item))return `「${row.item}」属于综合、商务或资信评分，不得计入技术标`;
  const title=compact(row.item),hits=lines.filter(line=>compact(line.text).includes(title));
  if(hits.length&&hits.some(h=>h.scope==='other')&&!hits.some(h=>h.scope==='tech'))return `「${row.item}」仅在综合、商务或资信部分出现，请按父类别排除并完整抽取技术子项`;
 }
 return null;
}
module.exports={category,scopedLines,scopeError};
