'use strict';

const L = require('./lexicon');

/**
 * L4 校验层（M16 / M17 / M18 / M19 / M20）。
 *
 * 这一层 90% 是规则，而且**必须**是规则：
 * 如果自检本身用模型，同一份稿子两次跑出不同结论，用户就没法依赖这个"通过"。
 *
 * 输出结构与小程序 `mock.buildCheck()` 一致，前端换数据源时不用改渲染。
 */

const LEVEL_ORDER = { block: 0, warn: 1, pass: 2 };
const bodyText=t=>(t.sections||[]).map(s=>Array.isArray(s.blocks)?s.blocks.map(require('../marker-bindings').textOfBlock).join('\n'):s.plain||s.text||'').join('\n');

function item(o) {
  return {
    id: o.id,
    level: o.level,
    cat: o.cat,
    title: o.title,
    detail: o.detail || '',
    fixType: o.fixType || 'manual',
    ...(o.scoreId!==undefined?{scoreId:o.scoreId,elementIds:o.elementIds||[],missingSection:!!o.missingSection}:{}),
    ...(o.loc?{loc:o.loc}:{}),
    count: o.count == null ? 0 : o.count,
    samples: (o.samples || []).slice(0, 4)
  };
}

function normalizeNo(s) {
  return String(s || '').replace(/[\s、.．:：()（）]/g, '');
}

/* ---------------- M17 合格性覆盖 ---------------- */

/**
 * 明确要求"逐条/逐项/单独成章"的条款才必须写条款号锚点。
 * 其余内容类条款（如"4.1 准确率不低于90%"）按实质关键词判断，
 * 否则真实标书会大面积误报阻断。
 */
const NEED_EXPLICIT = /逐条|逐项|逐款|单独成章|专章|专门章节|单独说明/;

/** 从条款文本抽实质关键词：量化指标 + 主题名词 */
function substanceKeys(text) {
  const keys = [];
  // 数字 + 单位（365日历天 / 1140.70万元 / 9.84万平方米）
  const numRe = /(\d+(?:\.\d+)?)\s*(日历天|个日历天|天|个月|年|万元|亿元|元|%|MPa|kV|kVA|m3|m³|m2|㎡|平方米|米|m|km)/g;
  let m;
  while ((m = numRe.exec(text))) keys.push(m[1]);
  // 主题名词
  const topics = ['工期', '质量', '安全', '环保', '造价', '进度', '设计', '施工', '调试', '验收', '培训', '运维', '服务'];
  for (const t of topics) if (text.includes(t)) keys.push(t);
  return [...new Set(keys)];
}

function checkQualCoverage(tender) {
  const quals = (tender.parse && tender.parse.qualifications) || [];
  const tech = quals.filter((q) => q.resp === 'tech');
  if (!tech.length) {
    return [item({
      id: 'C1', level: 'pass', cat: 'qual',
      title: '合格性条款已全部响应',
      detail: '没有需要在技术标内响应的条款，或条款均已标注为「需另附材料 / 不涉及」。'
    })];
  }

  const text = bodyText(tender);
  const flat = normalizeNo(text);

  const hard = [];   // 明确要求逐条响应却没写 → 阻断
  const soft = [];   // 内容类条款关键词没覆盖 → 提醒，交人工核对

  for (const q of tech) {
    // 1. 条款号或指定锚点出现在正文 → 明确响应
    const anchors = [q.no, q.anchor].filter(Boolean).map(normalizeNo);
    if (anchors.some((a) => a && flat.includes(a))) continue;

    const clause = String(q.text || '');

    // 2. 明确要求逐条/逐项/单独成章 → 必须有锚点，否则阻断
    if (NEED_EXPLICIT.test(clause)) { hard.push(q); continue; }

    // 3. 其余按实质内容判断：抽得出关键词就看覆盖，抽不出交给人工
    const keys = substanceKeys(clause);
    if (!keys.length) continue;
    if (!keys.some((k) => text.includes(k))) soft.push(q);
  }

  const out = [];
  if (hard.length) {
    out.push(item({
      id: 'C1', level: 'block', cat: 'qual',
      title: `${hard.length} 条要求逐条响应的条款未在正文中响应`,
      detail: '招标文件明确要求逐条/逐项响应，但正文里找不到条款号锚点。漏一条即可能被判无效响应。',
      fixType: 'manual',
      count: hard.length,
      samples: hard.map((q) => `${q.no || q.anchor || '?'} ${q.text ? q.text.slice(0, 34) : ''}`)
    }));
  }
  if (soft.length) {
    out.push(item({
      id: 'C1-W', level: 'warn', cat: 'qual',
      title: `${soft.length} 条技术条款未在正文中找到对应内容`,
      detail: '按条款里的量化指标与主题词比对，正文均未出现。可能是真漏项，也可能表述不同，请人工核对。',
      fixType: 'manual',
      count: soft.length,
      samples: soft.map((q) => `${q.no || '?'} ${q.text ? q.text.slice(0, 34) : ''}`)
    }));
  }
  if (!out.length) {
    out.push(item({
      id: 'C1', level: 'pass', cat: 'qual',
      title: `${tech.length} 条技术标内条款已全部响应`,
      detail: '条款号锚点或实质内容均能在正文中找到对应。'
    }));
  }
  return out;
}

/* ---------------- M18 要素覆盖 ---------------- */

function checkElementCoverage(tender) {
  const bp = tender.blueprint || [];
  if (!bp.length) {
    return [item({
      id: 'C2', level: 'block', cat: 'cover',
      title: '施工图尚未生成',
      detail: '没有施工图就没有覆盖率口径，无法判断正文是否回答了评分标准。'
    })];
  }

  const covered = new Set();
  for (const s of tender.sections || []) {
    for (const b of s.blocks || []) {
      for (const e of b.covers || []) {
        if (b.type!=='h4'&&require('../marker-bindings').textOfBlock(b).trim()) covered.add(s.scoreId + ':' + e);
      }
    }
  }

  const items = [];
  for (const row of bp) {
    const els = row.elements || [];
    const miss = els.filter((e) => !covered.has(row.scoreId + ':' + e.id));
    if (!miss.length) continue;
    items.push(item({
      id: 'C2-' + row.scoreId, level: 'block', cat: 'cover',
      scoreId:row.scoreId,elementIds:miss.map(e=>e.id),missingSection:!(tender.sections||[]).some(s=>String(s.scoreId)===String(row.scoreId)),loc:row.item,
      title: `「${row.item}」还有 ${miss.length}/${els.length} 条要素没写`,
      detail: 'AI 将按该评分项的要求补写遗漏要素。',
      fixType: 'auto',
      count: miss.length,
      samples: miss.map((e) => `${e.id} ${e.name}`)
    }));
  }

  if (!items.length) {
    const total = bp.reduce((n, r) => n + (r.elements || []).length, 0);
    items.push(item({
      id: 'C2', level: 'pass', cat: 'cover',
      title: `${total} 条必答要素全部覆盖`,
      detail: '施工图里的每一条要素都能在正文里找到对应段落。'
    }));
  }
  return items;
}

/* ---------------- M19 合规核验 ---------------- */

function checkCompliance(tender) {
  const text = bodyText(tender);
  const items = [];

  const count = (w) => {
    let n = 0, from = 0;
    while (true) {
      const i = text.indexOf(w, from);
      if (i < 0) break;
      n += 1; from = i + w.length;
    }
    return n;
  };

  const darkHits = L.DARK_LABELS.map((w) => ({ w, n: count(w) })).filter((h) => h.n > 0);
  const darkHints = L.DARK_HINTS.map((w) => ({ w, n: count(w) })).filter((h) => h.n > 0);

  if (darkHits.length) {
    const total = darkHits.reduce((s, h) => s + h.n, 0);
    items.push(item({
      id: 'C3', level: 'block', cat: 'compliance',
      title: `暗标风险：正文出现 ${total} 处投标人自称`,
      detail: '技术标若采用暗标评审，出现"我公司/本单位"这类自称即可能被判无效。',
      fixType: 'auto',
      count: total,
      samples: darkHits.map((h) => `${h.w} ×${h.n}`)
    }));
  } else {
    items.push(item({
      id: 'C3', level: 'pass', cat: 'compliance',
      title: '未发现投标人自称',
      detail: '"我公司 / 本单位 / 我司"类表述均未出现。'
    }));
  }

  if (darkHints.length) {
    const total = darkHints.reduce((s, h) => s + h.n, 0);
    items.push(item({
      id: 'C3-W', level: 'warn', cat: 'compliance',
      title: `${total} 处可能涉及身份的词，请核对`,
      detail: '公司名、商标、品牌类词在暗标下要谨慎；设备品牌、材料品牌等选型表述可保留，投标人自身标识必须删除。',
      fixType: 'manual',
      count: total,
      samples: darkHints.map((h) => `${h.w} ×${h.n}`)
    }));
  }

  const tokens = new Set();
  let m;
  const re = new RegExp(L.STANDARD_RE.source, 'g');
  while ((m = re.exec(text))) tokens.add(`${m[1]} ${m[2]}`.replace(/\s+/g, ' '));

  const unknown = [...tokens].filter((t) => !L.STANDARD_WHITELIST.some((w) => t.startsWith(w)));
  if (unknown.length) {
    items.push(item({
      id: 'C4', level: 'warn', cat: 'compliance',
      title: `引用了 ${unknown.length} 个白名单外的规范号`,
      detail: '不是错，但要逐个核对是否真实存在。编造标准号是评标专家的常见扣分点。',
      fixType: 'manual',
      count: unknown.length,
      samples: unknown
    }));
  }

  return items;
}

/* ---------------- M16 占位符 ---------------- */

function checkPlaceholder(tender) {
  const text = bodyText(tender);
  const hits = [];
  let m;
  const re = new RegExp(L.PLACEHOLDER_RE.source, 'g');
  while ((m = re.exec(text))) hits.push(m[1].trim());

  if (!hits.length) {
    return [item({
      id: 'C5', level: 'pass', cat: 'placeholder',
      title: '无待确认占位符',
      detail: '所有要素都已落实为具体做法或参数。'
    })];
  }
  const {needsUser,isPlanHedge}=require('../facts');
  // 计划类内容（拟投入配置、供应商与入场计划、移交界面、以…为准）归 AI 写实，
  // 不再计入"需要用户提供的真实资料"，否则待补字段会变成填不完的表格。
  const auto=hits.filter(h=>!needsUser(h)||isPlanHedge(h));
  const manual=hits.filter(h=>needsUser(h)&&!isPlanHedge(h));
  return [
   ...(auto.length?[item({id:'C5-A',level:'block',cat:'placeholder',title:`${auto.length} 处方案内容需 AI 补全`,detail:'这些是方案编写任务，点击 AI 补写即可，无需用户逐项编写。',fixType:'auto',count:auto.length,samples:auto})]:[]),
   ...(manual.length?[item({id:'C5',level:'block',cat:'placeholder',title:`${manual.length} 处真实资料待补充`,detail:'需要你提供真实经历、入场安排或现场实测信息，填写后自动补入正文。',fixType:'manual',count:manual.length,samples:manual})]:[])
  ];
}

/* ---------------- M20 文风 ---------------- */

function checkStyle(tender) {
  const text = bodyText(tender);
  const chars = text.replace(/\s/g, '').length || 1;
  let emptyCount = 0;
  const found = [];
  for (const w of L.EMPTY_PHRASES) {
    let n = 0;
    let from = 0;
    while (true) {
      const i = text.indexOf(w, from);
      if (i < 0) break;
      n += 1;
      from = i + w.length;
    }
    if (n) { emptyCount += n; found.push(`${w} ×${n}`); }
  }

  const density = (emptyCount / chars) * 1000;
  if (density > 6) {
    return [item({
      id: 'C6', level: 'warn', cat: 'style',
      title: `空话密度偏高（每千字 ${density.toFixed(1)} 处）`,
      detail: '空话多说明段落没给具体做法，评委看不出差异化。',
      fixType: 'auto',
      count: emptyCount,
      samples: found
    })];
  }
  return [item({
    id: 'C6', level: 'pass', cat: 'style',
    title: '文风正常',
    detail: '空话密度在阈值内，参数与做法密度合格。'
  })];
}

/* ---------------- 门禁 ---------------- */

function gateOf(items) {
  const blocking = items.filter((i) => i.level === 'block').length;
  const warning = items.filter((i) => i.level === 'warn').length;
  const passed = items.filter((i) => i.level === 'pass').length;

  let gate;
  if (blocking > 0) {
    const cats = [...new Set(items.filter((i) => i.level === 'block').map((i) => i.cat))];
    gate = {
      canExport: false,
      title: `存在 ${blocking} 项阻断，暂不可导出`,
      desc: '需先处理：' + cats.map(catName).join('、')
    };
  } else if (warning > 0) {
    gate = {
      canExport: true,
      title: `可以导出，还有 ${warning} 项提醒`,
      desc: '提醒项不影响导出，但建议逐条确认。'
    };
  } else {
    gate = { canExport: true, title: '全部检查通过', desc: '阻断与提醒均已清零。' };
  }

  return { blocking, warning, passed, gate };
}

function catName(cat) {
  return {
    qual: '合格性响应',
    cover: '要素覆盖',
    compliance: '合规核验',
    placeholder: '占位符残留',
    supplement: '待补资料',
    style: '文风'
  }[cat] || cat;
}

function checkAll(tender) {
  const supplement=require('../supplements'),groups=supplement.getGroups(tender),st=supplement.stats(groups);
  const items = [
    ...((tender.sections || []).length && tender.sections.every(s => (s.blocks || []).some(b => b.type!=='h4'&&(b.text || '').trim())) ? [] : [item({ id: 'C0', level: 'block', cat: 'cover', title: '正文或章节内容为空',fixType:'auto' })]),
    ...(st.pendingGroups?[item({id:'SUP-PENDING',level:'block',cat:'supplement',title:`${st.pendingGroups} 组真实资料待补充`,detail:'项目经历、供应商和人员入场、培训安排请填写；确实无此项可声明缺失。AI 负责方案编写，不能替你编造企业事实。'})]:[]),
    ...(tender.parse?.scores?.some(s=>!s.custom&&!(s.score>0))?[item({id:'C-SCORE',level:'block',cat:'source',title:'评分细则未正确识别',detail:'源文件有评分表，请先重新解析；未识别的分值不能按0分使用。'})]:[]),
    ...(tender.parse?.meta?.outlineEdited?[item({id:'C-OUTLINE',level:'warn',cat:'outline',title:'大纲经过人工调整，请核对招标要求',detail:'人工新增、删除或调整章节后，请核对技术评分范围与招标文件的强制目录。',fixType:'manual'})]:[]),
    ...checkQualCoverage(tender),
    ...checkElementCoverage(tender),
    ...checkCompliance(tender),
    ...checkPlaceholder(tender),
    ...checkStyle(tender),
    ...require('../supplements').declarationWarnings(tender),
    ...(tender.supplementWarnings||[]).map((detail,i)=>item({id:'SUP-W'+i,level:'warn',cat:'supplement',title:'补充信息需要核对',detail}))
  ].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);

  return { items, ...gateOf(items),auto:items.filter(i=>i.level!=='pass'&&i.fixType==='auto').length,manual:items.filter(i=>i.level!=='pass'&&i.fixType==='manual').length, checkedAt: new Date().toISOString() };
}

module.exports = {
  checkAll,
  gateOf,
  checkQualCoverage,
  checkElementCoverage,
  checkCompliance,
  checkPlaceholder,
  checkStyle
};
