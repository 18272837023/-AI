'use strict';
// Schema 之外检查评分项的完整性，防止模型少返回一项却显示成功。
function validateBlueprint(data, scores) {
 const rows = data.items || [], expected = scores.map(s=>s.id);
 const ids = rows.map(r=>r.scoreId);
 if (!expected.length || rows.length !== expected.length || new Set(ids).size !== ids.length || ids.some(id=>!expected.includes(id))) return '施工图必须覆盖全部评分项，评分项 ID 不得遗漏、重复或新增';
 for (const row of rows) {
  if (!Array.isArray(row.elements) || !row.elements.length) return `评分项 ${row.scoreId} 尚未拆解要素`;
  const elementIds=row.elements.map(e=>e.id);
  if (new Set(elementIds).size !== elementIds.length || row.elements.some(e=>!e.id?.trim() || !e.name?.trim() || !e.mustHave?.trim())) return `评分项 ${row.scoreId} 的要素 ID、名称及必答要求不能为空或重复`;
 }
 return null;
}
module.exports = { validateBlueprint };
