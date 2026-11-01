'use strict';

const L = require('../rules/lexicon');
const { toLines, truncate } = require('../lib/util');

/**
 * 规则基线（fallback）。
 *
 * 三个用途：
 * 1. mock 模式下让整条链路能跑通、能回归，不依赖 API Key
 * 2. live 模式下模型输出连续不合规时的兜底，保证不会把半成品传下去
 * 3. 作为"模型到底比规则强多少"的对照组
 *
 * 必须说清楚：**规则基线不是生产质量**。它只能证明契约是通的，
 * 抽得准不准要靠 live 模式和真实招标文件验证。
 */

/* ---------------- 通用：按字段名找值 ---------------- */

function findField(sections, names, maxLen) {
  for (const s of sections) {
    for (const line of toLines([s.no,s.title,s.text].join('\n'))) {
      for (const n of names) {
        const re = new RegExp(n + '\\s*[:：]\\s*(.{2,' + (maxLen || 40) + '})');
        const m = re.exec(line);
        if (m) {
          return { value: m[1].trim(), section: s.no || s.title, page: s.page, quote: line };
        }
      }
    }
  }
  return null;
}

function ev(sections, hit) {
  if (hit) return { section: hit.section || '', page: hit.page == null ? null : hit.page, quote: truncate(hit.quote || hit.value, 80) };
  const first = sections[0];
  return { section: first ? first.no || first.title : '', page: first ? first.page : null, quote: '' };
}

const SECTOR_HINTS = [
  ['机场', '机场综合能源'], ['光伏', '光伏电站'], ['风电', '风电场'], ['储能', '储能电站'],
  ['市政', '市政道路'], ['道路', '市政道路'], ['桥梁', '桥梁工程'], ['房建', '房屋建筑'],
  ['医院', '医疗建筑'], ['学校', '教育建筑'], ['水利', '水利工程'], ['污水', '污水处理'],
  ['变电站', '输变电'], ['管网', '管网工程'], ['数据中心', '数据中心']
];

function guessSector(text) {
  for (const [k, v] of SECTOR_HINTS) if (text.includes(k)) return v;
  return '通用工程';
}

function guessType(text) {
  if (/EPC|设计.{0,4}采购.{0,4}施工|工程总承包/i.test(text)) return 'EPC 总承包';
  if (/施工总承包/.test(text)) return '施工总承包';
  if (/专业承包|专业分包/.test(text)) return '专业承包';
  return '施工总承包';
}

/* ---------------- M04 项目要素 ---------------- */

function projectInfo(sections) {
  const all = sections.map((s) => s.text).join('\n');
  const name = findField(sections, ['招标项目名称', '项目名称', '工程名称'], 200);
  const scope = findField(sections, ['招标范围', '建设规模', '工程规模', '建设内容'], 120);
  const duration = findField(sections, ['计划工期', '工期', '总工期'], 30);
  const quality = findField(sections, ['质量目标', '质量标准', '工程质量要求'], 60);
  const location = findField(sections, ['建设地点', '项目地点', '工程地点'], 40);
  const extra={};const fieldEvidence={};for(const[key,names]of Object.entries({purchaser:['招标人','采购人'],budget:['合同估算价','项目预算','采购预算'],deadline:['投标文件递交截止时间为','投标截止时间'],bidNo:['招标编号'],evalMethod:['评标办法','评标方法'],pageLimit:['页数上限'],blind:['技术标格式']})){const hit=findField(sections,names,100);extra[key]=hit?.value||'';if(hit)fieldEvidence[key]=ev(sections,hit);}

  const conf = [name, scope, duration, quality, location].filter(Boolean).length;
  return {
    name: name ? name.value : '未识别到工程名称',
    scope: scope ? scope.value : '',
    duration: duration ? duration.value : '',
    quality: quality ? quality.value : '',
    location: location ? location.value : '',
    type: guessType(all.slice(0, 3000)),
    sector: guessSector(all.slice(0, 5000)),
    ...extra,fieldEvidence,
    confidence: conf >= 4 ? 'medium' : 'low',
    evidence: ev(sections, name)
  };
}

/* ---------------- M05 合格性条款 ---------------- */

const CAT_RULES = [
  ['form', ['签字', '盖章', '密封', '份数', '装订', '格式', '标记', '签署', '逐页']],
  ['qual', ['资质', '证书', '业绩', '财务', '社保', '信用', '营业执照', '安全生产许可', '注册建造师']],
  ['resp', ['工期', '质量', '技术', '偏离', '方案', '承诺', '响应', '标准', '规范']]
];

function classifyCat(sentence) {
  for (const [cat, words] of CAT_RULES) {
    if (words.some((w) => sentence.includes(w))) return cat;
  }
  return 'resp';
}

const MATERIAL_WORDS = ['资质证书', '营业执照', '安全生产许可证', '业绩合同', '社保缴纳证明', '财务审计报告', '信用报告', '授权委托书'];

function judgeResp(sentence) {
  if (L.RESP_KEYWORDS.none.some((w) => sentence.includes(w))) return 'none';
  if (L.RESP_KEYWORDS.attach.some((w) => sentence.includes(w))) return 'attach';
  if (MATERIAL_WORDS.some((w) => sentence.includes(w))) return 'attach';
  return 'tech';
}

function qualifications(sections) {
  const pool = sections.filter((s) => /须知|资格|响应|废标|无效|评审/.test(s.title + s.text.slice(0, 120)));
  const items = [];
  const seen = new Set();

  for (const s of pool) {
    const sentences = s.text.split(/[。；;\n]/).map((x) => x.trim()).filter((x) => x.length >= 10 && x.length <= 140);
    for (const sent of sentences) {
      if (!/应当|必须|不得|禁止|须|应提供|应提交|要求/.test(sent)) continue;
      if (!/(资质|证书|业绩|保证金|密封|签字|盖章|份数|工期|质量|偏离|承诺|人员|社保|信用)/.test(sent)) continue;
      const key = sent.slice(0, 24);
      if (seen.has(key)) continue;
      seen.add(key);

      const resp = judgeResp(sent);
      const cat = classifyCat(sent);
      const material = MATERIAL_WORDS.find((w) => sent.includes(w)) || '';
      items.push({
        no: s.no || '',
        cat,
        text: sent,
        resp,
        where: resp === 'attach' ? material || '相关证明材料' : '',
        anchor: resp === 'tech' ? (s.no || '第7章') : '',
        confidence: 'low',
        evidence: { section: s.no || s.title, page: s.page, quote: truncate(sent, 80) }
      });
      if (items.length >= 24) break;
    }
    if (items.length >= 24) break;
  }

  return { items };
}

/* ---------------- M06 评分细则 ---------------- */

const SCORE_LINE = /(.{2,40}?)[\s、:：]*(?:满分|分值|得分)?\s*(\d{1,3}(?:\.\d)?)\s*分/;

/** 单项评分上限 20 分（总分行如"总分 100 分"应被排除） */
const MAX_ITEM_SCORE = 20;
/** 这些词出现时说明是总述行而不是评分项 */
const SUM_WORDS = /总分|合计|共计|满分\s*\d{2,3}\s*分.*技术|总分\s*\d{2,3}/;

function scores(sections) {
  const pool = sections.filter((s) => /评分|评标|评审|分值|打分/.test(s.title + s.text.slice(0, 200)));
  const items = [];
  const seen = new Set();
  let seq = 0;

  for (const s of pool) {
    for (const line of toLines(s.text)) {
      if (/报价|价格分|商务分|业绩分/.test(line) && !/技术/.test(line)) continue;
      if (SUM_WORDS.test(line)) continue;
      const m = SCORE_LINE.exec(line);
      if (!m) continue;
      const scoreVal = Number(m[2]);
      if (scoreVal > MAX_ITEM_SCORE) continue;
      const item = m[1].replace(/^[（(]?\d+[)）.、]?\s*/, '').replace(/[：:]+$/, '').trim();
      if (item.length < 2) continue;
      const key = item.slice(0, 16);
      if (seen.has(key)) continue;
      seen.add(key);
      seq += 1;
      items.push({
        id: 'S' + seq,
        item,
        score: Number(m[2]),
        tierDesc: truncate(line, 160),
        keywords: item.split(/[与和及、\/]/).filter((x) => x.length >= 2).slice(0, 5),
        confidence: 'low',
        evidence: { section: s.no || s.title, page: s.page, quote: truncate(line, 80) }
      });
      if (items.length >= 14) break;
    }
    if (items.length >= 14) break;
  }

  return { items };
}

/* ---------------- M07 大纲模式 ---------------- */

function outlineMode(sections) {
  const strictRe = /(按|采用|参照).{0,12}(投标文件格式|技术标格式|第[一二三四五六七八九十\d]+章).{0,10}(格式|编制|顺序)/;
  const freeRe = /(章节|结构|目录).{0,8}(自拟|自行编制|自行确定)/;

  for (const s of sections) {
    for (const line of toLines(s.text)) {
      if (strictRe.test(line)) {
        return {
          mode: 'strict', confidence: 'medium',
          reason: '招标文件明确要求按给定格式与顺序编制，标题不可增删改',
          evidence: { section: s.no || s.title, page: s.page, quote: truncate(line, 80) }
        };
      }
      if (freeRe.test(line)) {
        return {
          mode: 'free', confidence: 'medium',
          reason: '招标文件允许投标人自行拟定章节结构',
          evidence: { section: s.no || s.title, page: s.page, quote: truncate(line, 80) }
        };
      }
    }
  }

  const first = sections[0];
  return {
    mode: 'guided', confidence: 'low',
    reason: '未找到明确的格式条款，按"给定必须包含的内容 + 允许增补"处理',
    evidence: { section: first ? first.no || first.title : '', page: first ? first.page : null, quote: '' }
  };
}

/* ---------------- M09 施工图 ---------------- */

const ELEMENT_TEMPLATES = [
  { match: /安全|危险|职业健康/, els: [
    ['安全管理体系与责任人', '项目经理为第一责任人的安全管理网络，专职安全员不少于 1 人'],
    ['危险源识别清单与分级', '重大危险源清单，逐项标注风险等级与控制措施'],
    ['专项安全技术措施', '危大工程专项方案数量与论证要求'],
    ['安全检查频次与整改闭环', '检查频次（日/周/月）与整改闭环时限'],
    ['应急物资配置与演练', '应急物资品类数量与演练次数']
  ]},
  { match: /质量|验收|检验/, els: [
    ['质量目标与验收标准', '一次验收合格率目标与执行标准号'],
    ['质量管理组织与岗位职责', '质量负责人岗位设置与职责分工'],
    ['材料进场检验', '主要材料进场复检项目与抽检比例'],
    ['工序三检与隐蔽验收', '自检、互检、专检的实施节点与记录'],
    ['质量通病防治措施', '本工程易发通病清单与针对性做法']
  ]},
  { match: /进度|工期|计划/, els: [
    ['总进度计划与里程碑', '开工、竣工日期与关键里程碑节点'],
    ['关键线路与资源配置', '关键线路工序与劳动力、机械投入峰值'],
    ['进度纠偏机制', '偏差预警阈值与纠偏动作'],
    ['周月报与例会制度', '报表频次与例会周期']
  ]},
  { match: /环保|绿色|扬尘|噪声|节能/, els: [
    ['环保目标与量化指标', '扬尘、噪声、污水排放的限值与监测方式'],
    ['扬尘与噪声控制措施', '围挡、喷淋、覆盖等具体做法与频次'],
    ['废弃物分类与处置', '建筑垃圾分类比例与处置去向'],
    ['能耗与碳排放监测', '监测点位、计量方式与统计周期']
  ]},
  { match: /组织|人员|机构|培训|劳动力/, els: [
    ['项目组织机构与岗位设置', '管理层级、部门设置与关键岗位'],
    ['关键岗位人员配置', '岗位名称、人数与持证要求'],
    ['人员进场计划', '进场时间、人数峰值与来源'],
    ['培训与考核', '培训对象、内容、频次与考核方式']
  ]},
  { match: /技术|方案|工艺|设备|调试/, els: [
    ['技术路线与工艺选择', '工艺路线名称与选择依据'],
    ['关键工序施工方法', '关键工序的作业步骤与工艺参数'],
    ['设备选型与参数', '主要设备型号、数量与关键参数'],
    ['技术复核与试验检测', '复核项目、检测频次与判定标准']
  ]}
];

const DEFAULT_ELEMENTS = [
  ['总体思路与目标', '总体目标的可量化表述与实现路径'],
  ['组织与职责分工', '责任岗位设置与接口关系'],
  ['具体做法与工艺参数', '做法名称与关键参数值'],
  ['检查与纠偏机制', '检查频次与偏差处置动作'],
  ['记录与追溯', '过程记录表单与留存期限']
];

function blueprint(scoresData) {
  const items = (scoresData.items || []).map((s) => {
    const tpl = ELEMENT_TEMPLATES.find((t) => t.match.test(s.item + s.tierDesc));
    const src = tpl ? tpl.els : DEFAULT_ELEMENTS;
    const elements = src.map((e, i) => ({
      id: 'E' + (i + 1),
      name: e[0],
      mustHave: e[1]
    }));
    return {
      scoreId: s.id,
      item: s.item,
      score: s.score,
      tierDesc: s.tierDesc,
      keywords: s.keywords || [],
      elements
    };
  });
  return { items };
}

/* ---------------- M13 要素表 ---------------- */

function elementTable(row) {
  const rows = (row.elements || []).map((e) => ({
    elementId: e.id,
    name: e.name,
    approach: `按专项方案组织实施，${e.name}明确责任岗位、验收标准与过程记录`,
    params: '按本项目要求编制专项实施清单，执行前交底，实施中检查，完成后验收并记录结果',
    owner: '项目技术负责人',
    frequency: '每周一次',
    confidence: 'low'
  }));
  return { scoreId: row.scoreId, item: row.item, rows };
}

/* ---------------- M14 正文 ---------------- */

function sections(row) {
  const blocks = [];
  for (const r of row.rows || []) {
    blocks.push({ type: 'h4', text: r.name, covers: [] });
    blocks.push({
      type: 'p',
      text:
        `项目部针对${r.name}明确${r.approach}。` +
        `执行参数为${r.params}，由${r.owner}负责，按${r.frequency}的频率检查并留存记录，` +
        `发现偏差当场下发整改单并在下次检查时复核闭合。`,
      covers: [r.elementId]
    });
  }
  return { scoreId: row.scoreId, title: row.item, blocks };
}

module.exports = {
  projectInfo,
  qualifications,
  scores,
  outlineMode,
  blueprint,
  elementTable,
  sections,
  guessSector,
  guessType
};
