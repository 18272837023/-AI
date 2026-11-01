'use strict';
const Ajv = require('ajv');
const { SCHEMAS } = require('./pipeline/units');
const store = require('./lib/store');
const checks = require('./rules/check');
const ajv = new Ajv({ strict: false, allowUnionTypes: true });
ajv.addFormat('iso-date', /^\d{4}(-\d{2}){0,2}$/);
const validators = Object.fromEntries(Object.entries(SCHEMAS).map(([k, s]) => [k, ajv.compile(s)]));
function bad(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }
function validate(name, value) {
  if (!validators[name](value)) bad('数据格式错误：' + ajv.errorsText(validators[name].errors));
}
function unique(values, label) {
  if (new Set(values).size !== values.length) bad(label + '不能重复');
}
function assertLinks(t, field, items) {
  const source = field === 'blueprint' ? t.parse.scores : field === 'elements' ? t.blueprint : t.elements;
  const expected = source.map(s => s.scoreId || s.id);
  unique(items.map(s => s.scoreId), '评分项 ID');
  if (items.length !== expected.length || items.some(s => !expected.includes(s.scoreId))) bad('必须完整保留全部评分项 ID');
  for (const group of items) {
    const bp = (field === 'blueprint' ? items : t.blueprint).find(g => g.scoreId === group.scoreId);
    const ids = bp.elements.map(e => e.id);
    if (field === 'blueprint') unique(ids, '同一评分项内要素 ID');
    if (field === 'elements') {
      unique(group.rows.map(r => r.elementId), '要素 ID');
      if (group.rows.length !== ids.length || group.rows.some(r => !ids.includes(r.elementId))) bad('要素表必须保留全部施工图要素 ID');
    }
    if (field === 'sections' && group.blocks.some(b => b.covers.some(e => !ids.includes(e)))) bad('段落关联了不存在的要素');
  }
}
function edit(t, field, body) {
  if (!Number.isInteger(body.revision) || body.revision !== (t.revision || 0)) bad('项目已变化，请刷新后再保存', 409);
  if (!t[field]) bad('该阶段尚未生成', 409);
  let value = body.value;
  if (field === 'parse') {
    if (!value || typeof value !== 'object') bad('缺少解析数据');
    validate('projectInfo', value.project);
    validate('qualifications', { items: value.qualifications });
    validate('scores', { items: value.scores });
    validate('outlineMode', value.outline);
    unique(value.scores.map(s => s.id), '评分项 ID');
    value = { ...value, scoreSum: value.scores.reduce((n, s) => n + s.score, 0), meta: { ...t.parse.meta, edited: true } };
  } else {
    if (!Array.isArray(value) || !value.length) bad('至少需要一项数据');
    validate({ blueprint: 'blueprint', elements: 'elementTable', sections: 'sections' }[field], { items: value });
    assertLinks(t, field, value);
  }
  if (field === 'sections') value = value.map(s => {
    for(const b of s.blocks)if(b.type==='table'&&(!b.rows?.length||b.rows.some(r=>r.length!==b.rows[0].length)))bad('表格缺少内容或列数不一致');
    const plain = s.blocks.map(b => b.type==='table'?[b.text,...b.rows.map(r=>r.join(' | '))].join('\n'):b.text).join('\n');
    return { scoreId: s.scoreId, title: s.title, blocks: s.blocks, plain, wordCount: plain.replace(/\s/g, '').length, edited: true };
  });
  store.invalidateTender(t.id, { parse: 'blueprint', blueprint: 'elements', elements: 'generate', sections: 'generate' }[field]);
  store.updateTender(t.id, { ...(field === 'parse' && value.project.name.trim() && value.project.name !== t.parse.project.name ? {name:value.project.name.trim(),nameSource:'manual'} : {}), [field]: value, status: field === 'sections' ? 'generated' : field === 'parse' ? 'parsed' : field });
  if (field === 'sections') store.updateTender(t.id, { check: checks.checkAll(t) });
  store.flush();
  return { revision: t.revision, value: t[field], check: t.check };
}
module.exports = { edit };
