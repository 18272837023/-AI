'use strict';
function cleanName(value) {
  const name = String(value || '').trim();
  return name && name.length <= 200 && !/^(?:未识别|未命名|待确认|待填写|不详|未知|项目名称|工程名称|招标文件|招标公告|段名称[）)]|标段名称[）)])/.test(name) ? name : '';
}
function extractName(doc) {
  for (const page of doc.pages || []) {
    const lines = page.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const cover=lines.slice(0,lines.findIndex(s=>s==='招标文件')>=0?lines.findIndex(s=>s==='招标文件'):0).join('').replace(/^[IVXLCDM\d]+/,'');
    const labeled=/^(.+?)[（(]项目名称[）)](.+?)[（(]标段名称[）)]/.exec(cover);
    if(labeled){const name=cleanName(labeled[2]);if(name)return {name,evidence:{page:page.page,quote:lines.slice(0,5).join('\n')}};}
    for (let i = 0; i < lines.length; i++) {
      const m = /^(?:[\d.、（）()]+\s*)?(?:招标项目|采购项目|项目|工程)\s*名\s*称\s*[:：]?\s*(.*)$/.exec(lines[i]);
      if (!m) continue;
      const raw = m[1] || lines[i + 1] || '';
      // DOCX 表格可能把字段和值分到相邻段落；后续字段不能被当作名称。
      const value = raw.split(/\t|\s+(?:招标编号|项目编号|建设地点|招标人|采购人)\s*[:：]/)[0].trim();
      const name = cleanName(value);
      if (name && !/^(?:[\d.]+\s*)?(?:招标编号|项目编号|建设地点|招标人|采购人)\s*[:：]/.test(name)) return { name, evidence: { page:page.page, quote:m[1] ? lines[i] : lines[i] + '\n' + raw } };
    }
    // 封面无字段标签时，只接受紧邻“招标文件”的项目标题。
    for (let i = 0; i < Math.min(lines.length - 1, 40); i++) {
      if (/^(?:公开)?招标文件$/.test(lines[i+1].replace(/\s/g,'')) && /工程|项目/.test(lines[i]) && lines[i].length >= 6) {
        const name = cleanName(lines[i]); if (name) return {name,evidence:{page:page.page,quote:lines[i]}};
      }
    }
  }
  return {name:'',evidence:null};
}
function automaticNamePatch(tender, name) {
  const valid = cleanName(name);
  // 老项目未记录来源时保守保护已有名称。
  if (!valid || tender.nameSource === 'manual' || (!tender.nameSource && tender.name !== '未命名项目')) return {};
  return {name:valid,nameSource:'document'};
}
module.exports = { extractName, cleanName, automaticNamePatch };
