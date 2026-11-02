'use strict';
// 每章优先检索相关清单行，并为每张表保留表头及概览；避免清单被常规章节挤出上下文。
function attachmentContext(sections, item) {
  const sheets = sections.filter(s=>s.fromAttachment && /工作表：/.test(s.title));
  const terms = String(item||'').match(/[\u4e00-\u9fff]{2,}/g)||[];
  const seen = new Set(), out = []; let used=0;
  for (const s of sheets) {
    const key=s.fromAttachment+' '+s.title.replace(/（清单分段.*$/,'');
    const lines=s.text.split('\n');
    const picked=lines.filter((line,i)=>(!seen.has(key)&&i<6)||terms.some(t=>line.includes(t)));
    seen.add(key);
    if (!picked.length) continue;
    const chunk=`【${key}】\n${picked.join('\n')}`;
    if (used+chunk.length>14000) { out.push('其余清单行未在本章上下文展开，禁止据此声称已核对全部工程量。');break; }
    out.push(chunk);used+=chunk.length;
  }
  return out.join('\n\n');
}
module.exports={attachmentContext};
