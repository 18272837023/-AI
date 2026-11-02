'use strict';
const {scoringSections} = require('./validation');

// 不再将评分表的每个碎片截成 2600 字；保留相邻子节、表格及跨页续行。
function context(sections) {
  let selected = scoringSections(sections);
  if (selected === sections) {
    const indexes = new Set();
    sections.forEach((s,i) => {
      if (/评分|评审标准|评标|分值|评审内容|评审因素/.test((s.title||'')+'\n'+(s.text||''))) {
        for (let j=Math.max(0,i-1); j<=Math.min(sections.length-1,i+2); j++) indexes.add(j);
      }
    });
    if (indexes.size) selected = sections.filter((_,i)=>indexes.has(i));
  }
  const text = selected.map(s=>`【${s.no||''} ${s.title||''}｜P${s.page||'未知'}】\n${s.text||''}`).join('\n\n');
  if (text.length > 120000) throw Error('评分章节超过单次可核对范围，请拆分上传完整的评审标准章节；未截断评分表继续生成');
  return text;
}

function ruleScores(sections) {
  const selected = scoringSections(sections), items = [], seen = new Set();
  const lines = require('./scoring-scope').scopedLines(selected);
  for (let i=0;i<lines.length;i++) {
    const {text,s} = lines[i];
    if (!text) continue;
    if (lines[i].scope==='other') continue;
    let name, score, standard = '';
    const cells = text.split(/\s*\|\s*/);
    // 表格：父类可能纵向合并，只认“名称 | 分值 | 评审标准”的相邻列。
    for (let c=1;c<cells.length;c++) {
      if (!/^(?:\d{1,2}(?:\.\d+)?|100)\s*分?$/.test(cells[c])) continue;
      if (!/[\u4e00-\u9fff]/.test(cells[c-1]) || /技术部分|商务部分|综合标|综合部分|总分|合计|序号/.test(cells[c-1])) continue;
      name=cells[c-1];score=Number(cells[c].replace('分',''));standard=cells.slice(c+1).join(' | ');break;
    }
    // 原有 TXT/DOCX 纵向单元格：名称、裸分值、标准可能各占一行。
    if (!name && /^[\u4e00-\u9fff][^。；;：:|\d]{1,35}$/.test(text) && /^\d{1,2}(?:\.\d+)?\s*分?$/.test(lines[i+1]?.text||'')) {
      name=text;score=Number(lines[++i].text.replace('分',''));
    }
    if (!name) {
      const m = /^(.{2,40}?)\s*(?:满分|分值)?\s*(\d{1,2}(?:\.\d+)?)\s*分[：:，,\s]*(.*)$/.exec(text);
      if (m) {name=m[1];score=Number(m[2]);standard=m[3];}
    }
    if (!name || !(score>0&&score<=100)) continue;
    name=name.replace(/^[（(]?\d+[)）.、]?\s*/,'').trim();
    if (/总分|合计|共计|报价|价格|商务|综合标|综合部分|业绩|技术部分|技术标$|本评审项|得分|计分|评分标准|评审标准/.test(name) || name.length<2) continue;
    // 续表直到下个清晰的评分行/章节，保留完整阶梯评分原文。
    let end=i+1;
    while (end<lines.length) {
      const next=lines[end].text;
      if(lines[end].heading)break;
      if (/^第.+章/.test(next) || /合计\s*[|：:]?\s*100/.test(next) || /\|\s*\d+(?:\.\d+)?\s*分?\s*\|/.test(next)) break;
      if (/^[\u4e00-\u9fff][^。；;：:|\d]{1,35}$/.test(next)&&/^\d+(?:\.\d+)?\s*分?$/.test(lines[end+1]?.text||'')) break;
      if (/^.{2,40}?\s+\d+(?:\.\d+)?\s*分[：:]/.test(next)) break;
      standard += '\n'+next;end++;
    }
    standard=standard.trim();
    if (!standard || !/分|评分|评审|得|计/.test(standard) || seen.has(name)) continue;
    seen.add(name);
    items.push({id:'S'+(items.length+1),item:name,score,tierDesc:standard,keywords:name.split(/[与和及、/]/).filter(Boolean),confidence:'low',evidence:{section:s.no||s.title,page:s.page??null,quote:text}});
    i=end-1;
  }
  return {items};
}
module.exports={context,ruleScores};
