'use strict';

const L = require('../rules/lexicon');
const { truncate } = require('../lib/util');

/**
 * 六个抽取/生成单元的定义：Schema + Prompt + 规则基线。
 *
 * 每个单元三件套放在一起，是为了让"模型版"和"规则版"始终共用同一份契约。
 * 改字段时改一处，两边一起变——这是设计文档里"契约化"原则的最小实现。
 */

/* ============================ Schema ============================ */

const EVIDENCE = {
  type: 'object',
  required: ['section', 'page', 'quote'],
  properties: {
    section: { type: 'string' },
    page: { type: ['integer', 'null'] },
    quote: { type: 'string' }
  }
};

const CONFIDENCE = { type: 'string', enum: ['high', 'medium', 'low'] };

const SCHEMAS = {
  // M04 项目要素
  projectInfo: {
    type: 'object',
    required: ['name', 'scope', 'duration', 'quality', 'location', 'type', 'sector', 'purchaser', 'budget', 'deadline', 'bidNo', 'evalMethod', 'pageLimit', 'blind', 'confidence', 'evidence'],
    properties: {
      name: { type: 'string' },
      scope: { type: 'string' },
      duration: { type: 'string' },
      quality: { type: 'string' },
      location: { type: 'string' },
      type: { type: 'string', description: '承包模式，如 EPC 总承包 / 施工总承包' },
      sector: { type: 'string', description: '行业类型，如 机场综合能源 / 市政道路' },
      purchaser:{type:'string',description:'实际招标人/采购人，不能误取代理机构'},
      budget:{type:'string',description:'原文项目预算/合同估算价，带单位和金额性质，不得把业绩门槛当预算'},
      deadline:{type:'string',description:'投标文件递交截止时间，不是文件获取截止时间'},
      bidNo:{type:'string',description:'本标段招标编号，优先公告里的完整编号'},
      evalMethod:{type:'string'},pageLimit:{type:'string'},blind:{type:'string',description:'明标/暗标及对应编制要求，原文未明确则空字符串'},
      fieldEvidence:{type:'object',additionalProperties:EVIDENCE},
      fieldStatus:{type:'object',additionalProperties:{type:'string',enum:['found','not_specified','unresolved']}},
      confidence: CONFIDENCE,
      evidence: EVIDENCE
    }
  },

  // M05 合格性条款
  qualifications: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['no', 'cat', 'text', 'resp', 'where', 'anchor', 'confidence', 'evidence'],
          properties: {
            no: { type: 'string' },
            cat: { type: 'string', enum: ['form', 'qual', 'resp'] },
            text: { type: 'string' },
            resp: { type: 'string', enum: ['tech', 'attach', 'none'] },
            where: { type: 'string', description: '需另附材料时，说明材料名称；否则填空字符串' },
            anchor: { type: 'string', description: '技术标内响应时，建议写在哪一章' },
            confidence: CONFIDENCE,
            evidence: EVIDENCE
          }
        }
      }
    }
  },

  // M06 评分细则
  scores: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'item', 'score', 'tierDesc', 'keywords', 'confidence', 'evidence'],
          properties: {
            id: { type: 'string' },
            item: { type: 'string' },
            score: { type: 'number' },
            tierDesc: { type: 'string', description: '档次描述原文，这是生成标准' },
            keywords: { type: 'array', items: { type: 'string' } },
            confidence: CONFIDENCE,
            evidence: EVIDENCE
          }
        }
      }
    }
  },

  // M07 大纲模式
  outlineMode: {
    type: 'object',
    required: ['mode', 'confidence', 'reason', 'evidence'],
    properties: {
      mode: { type: 'string', enum: ['strict', 'guided', 'free'] },
      confidence: CONFIDENCE,
      reason: { type: 'string' },
      evidence: EVIDENCE
    }
  },

  // M09 施工图
  blueprint: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['scoreId', 'item', 'score', 'tierDesc', 'keywords', 'elements'],
          properties: {
            scoreId: { type: 'string' },
            item: { type: 'string' },
            score: { type: 'number' },
            tierDesc: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            elements: {
              type: 'array',
              minItems: 3,
              maxItems: 8,
              items: {
                type: 'object',
                required: ['id', 'name', 'mustHave'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  mustHave: { type: 'string', description: '名词 + 可验证量，禁止纯形容词' }
                }
              }
            }
          }
        }
      }
    }
  },

  // M13 要素表
  elementTable: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['scoreId', 'item', 'rows'],
          properties: {
            scoreId: { type: 'string' },
            item: { type: 'string' },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                required: ['elementId', 'name', 'approach', 'params', 'owner', 'frequency', 'confidence'],
                properties: {
                  elementId: { type: 'string' },
                  name: { type: 'string' },
                  approach: { type: 'string', description: '具体做法' },
                  params: { type: 'string', description: '参数/指标；不知道就写〔待确认：xxx〕' },
                  owner: { type: 'string' },
                  frequency: { type: 'string' },
                  confidence: CONFIDENCE
                }
              }
            }
          }
        }
      }
    }
  },

  // M14 正文
  sections: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['scoreId', 'title', 'blocks'],
          properties: {
            scoreId: { type: 'string' },
            title: { type: 'string' },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['type', 'text', 'covers'],
                allOf:[{if:{properties:{type:{const:'table'}}},then:{required:['rows']}}],
                properties: {
                  type: { type: 'string', enum: ['h4', 'p', 'table'] },
                  text: { type: 'string' },
                  rows: {type:'array',minItems:2,maxItems:12,items:{type:'array',minItems:2,maxItems:6,items:{type:'string'}}},
                  covers: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        }
      }
    }
  }
};

/* ============================ Prompt ============================ */

const SYSTEM_BASE = [
  '你是资深投标文件编制专家，只做技术标（施工组织设计 / 技术方案）。',
  '铁律：',
  '1. 只依据给定原文作答，原文没写的不要编。信息缺失时留空字符串，不要猜。',
  '2. 每一条抽取结果都要给 evidence（章节号、页码、原文片段），片段必须是原文连续子串。',
  '3. 不确定就给 confidence=low，不要为了好看给 high。',
  '4. 只输出 JSON，不要任何解释文字、不要 Markdown 代码块。'
].join('\n');
const SYSTEM_WRITE = '你是技术标编制专家。招标文件是需求，投标方案是你应编写的未来实施计划。根据项目范围编写可执行做法、岗位职责、工作流程与合理的计划安排；不得编造已发生的业绩、已配置的人员设备、证书及现场实测事实。招标已有的信息直接引用，不要再问用户；常规方案和建议计划由你写完整。只输出符合 Schema 的 JSON。';

function docBlock(sections, maxChars) {
  const parts = [];
  let used = 0;
  for (const s of sections) {
    const head = `【${s.no ? s.no + ' ' : ''}${s.title}｜${s.page ? 'P' + s.page : '页码未知'}】`;
    const body = truncate(s.text, 2600);
    const chunk = head + '\n' + body;
    if (used + chunk.length > (maxChars || 26000)) break;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join('\n\n');
}

/** 按关键词挑相关章节，避免把整份招标文件塞进上下文 */
function pickSections(sections, keywords, opts) {
  const o = opts || {};
  const max = o.max || 12;
  const kw = keywords || [];
  const scored = sections.map((s) => {
    const hay = s.no + s.title + (s.text || '').slice(0, 400);
    let score = 0;
    for (const k of kw) if (hay.includes(k)) score += 1;
    if (s.charCount > 2000) score += 0.5;
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((x) => x.score > 0).slice(0, max).map((x) => x.s);
  return picked.length ? picked : sections.slice(0, max);
}

const PROMPTS = {
  projectInfo(sections,pages) {
    return {
      system: SYSTEM_BASE,
      user: [
        '任务：从招标文件中抽取项目要素。字段含义：',
        '- name 工程名称；scope 建设规模与范围（含量化指标）；duration 工期；quality 质量目标；location 建设地点',
        '- type 承包模式（EPC 总承包 / 施工总承包 / 专业承包）；sector 行业类型（如 机场综合能源、市政道路）',
        '- purchaser 实际招标人（非代理机构）；budget 项目预算或合同估算价（保留金额、单位和性质）；deadline 投标文件递交截止时间（不是下载截止）',
        '- bidNo 本标段完整招标编号（优先公告而非封面父项目编号）；evalMethod 评标办法；pageLimit 技术标页数上限；blind 明标/暗标及格式要求',
        '- 每个非空字段在 fieldEvidence 中分别给原文连续引用、所在小节与页码。上下相邻段落及标题也含字段值，不能只看正文。未找到才留空，不得以“待核对原文”代替抽取',
        '- P 后数字是 PDF 实际页序号，引用时使用该页序号，不使用页脚印刷页码。封面可能只有父项目编号，完整标段招标编号优先采用公告。目录点引线条目不作为项目事实或证据。',
        '- fieldEvidence.quote 可选取足以证明字段的一段连续原文，不必包含整个字段描述。表格中间夹有条款号、字段名时应保留，不能跳列拼接成连续引文。',
        '- evidence 指向最能证明这些要素的那一段',
        '',
        '原文：',
        require('./analysis').projectContext(sections,pages)
      ].join('\n')
    };
  },

  qualifications(sections) {
    return {
      system: SYSTEM_BASE,
      user: [
        '任务：抽取合格性（形式/资格/响应性）条款，并判定响应方式。',
        'cat：form=形式性（签字盖章密封份数）、qual=资格性（资质业绩人员）、resp=响应性（工期质量技术偏离）',
        'resp：tech=必须写进技术标；attach=需另附材料（证书/证明原件）；none=与本次技术标无关（报价/保证金等）',
        'where：resp=attach 时写材料名称；anchor：resp=tech 时写建议响应的章节号。',
        '只收真正会导致废标的硬性条款，不要把评分项混进来。',
        '必须同时读取公告资格条件、形式评审、资格评审、响应性评审表，不能只抽取资质附件。响应性表的工期、质量、招标范围/投标内容、承包人建议符合发包人要求，均应抽成 resp=tech；合同及通用文件中出现工期一词，不等同于新增硬性条款。',
        '表中“符合第二章某条”的交叉引用要结合须知前附表对应条款，写明具体要求，不只输出“符合第X条”。no 使用真实条款编号并区分同表不同行。',
        '',
        '原文：',
        require('./analysis').qualificationContext(sections)
      ].join('\n')
    };
  },

  scores(sections) {
    return {
      system: SYSTEM_BASE,
      user: [
        '任务：抽取技术标评分细则。',
        '要求：',
        '- score 是该项分值（数字，不要带"分"字）；所有技术标评分项分值合计应等于技术标总分',
        '- tierDesc 必须抄原文的档次描述（一档/二档/三档分别得多少分），这是后面写正文的唯一标准',
        '- keywords 是该评分项的关键得分点，3—6 个',
        '- 只抽技术标评分项；综合标、综合部分、商务、资信、报价、业绩分值必须排除。逐项确认父类别：合并单元格或跨页空白继承上一父类别，直到出现新类别，不得仅因子项写了“管理”“人员”“服务”就视为技术标。综合评分表是整张表标题时，仍按表内技术/综合/商务父类别区分。',
        '- 严格区分“承包人建议书/实施方案”与“资信业绩部分”。资信业绩下的类似项目业绩、负责人资格、团队人员配备均属于资信业绩，不纳入技术方案。技术子项合计必须等于原文中各技术父项之和',
        '- 读取完整前附表，展开父项下的具体评分子项，不重复计入父项；按原文顺序输出。引用“见前附表”的计算说明不是评分子项，必须回到前附表查找，不能填0分',
        '- 支持“评审标准”“技术部分”表格：竖线 | 表示单元格边界，裸数字（如 6、10）为分值列，不要求带“分”。合并单元格只在首行有类别；跨页续行归入上一评分项。技术服务方案、履约保障、应急方案、服务承诺也属于技术评分，不只识别施工类标题。',
        '',
        '原文：',
        require('./score-source').context(sections)
      ].join('\n')
    };
  },

  outlineMode(sections) {
    return {
      system: SYSTEM_BASE,
      user: [
        '任务：判定技术标大纲应采用哪种模式。',
        'strict：招标文件明确规定了技术标章节标题和顺序，必须照抄，不得增删',
        'guided：给了参考格式或必须包含的内容清单，但允许在此基础上增补',
        'free：只要求包含某些内容，章节结构由投标人自拟',
        'reason 说明判据；evidence 必须引用规定格式的那句原文。判不准就给 confidence=low。',
        '',
        '原文：',
        require('./analysis').outlineContext(sections)
      ].join('\n')
    };
  },

  blueprint(scores) {
    const brief = scores.map((s) => ({
      scoreId: s.id, item: s.item, score: s.score, tierDesc: s.tierDesc, keywords: s.keywords
    }));
    return {
      system: SYSTEM_BASE,
      user: [
        '任务：把每个评分项拆成"必答要素清单"，这是整条生成链的标准源。',
        '规则：',
        '- 每个评分项拆 4—7 条要素（少于 4 条拆太粗、缺项风险高；多于 7 条拆太细、用户判断不了）',
        '- 不得把段落数、规范引用数量、图表数量或措施条目数人为设成必须用户提供的项目参数；这些编写统计由系统处理',
        '- mustHave 必须是"名词 + 可验证量"，例如"临时用电容量与回路数"；纯形容词（如"措施到位"）打回',
        '- 要素要覆盖 tierDesc 里所有能得分的点，不要只抄标题',
        '- id 用 E1、E2…按评分项内顺序编号',
        '',
        '评分项：',
        JSON.stringify(brief, null, 2)
      ].join('\n')
    };
  },

  elementTable(blueprintRow, context = {}) {
    return {
      system: SYSTEM_WRITE,
      user: [
        '任务：把施工图要素表填成可写正文的要素表。每一行回答四个问题：怎么做、做到什么程度、谁负责、多久一次。',
        '规则：',
        '- approach 必须是可执行动作，不要写"加强管理"这类空话',
        '- elementId 必须原样照抄下方要素里的 id（如 E1、E2），不得改写、合并或新增；每个要素各出一行',
        '- params 按需要写指标或验收条件，不强求每条数字。原文已给定的参数直接引用。方案流程、检查频次、拟实施的计划由你编写为未来承诺，不因招标未给数值而留空',
        '- 只有真实类似业绩、供应商及人员入场安排、用户公司的实际情况与实测现场条件才可留〔待确认：具体事实〕。禁止为段落数、表格数、步骤数、规范引用数、评分分值生成占位符',
        '- owner 写岗位不写人名（暗标要求）；frequency 写频次（如"每日一次"）',
        '- 不知道就给 confidence=low',
        '',
        '评分项与要素：',
        JSON.stringify(blueprintRow, null, 2),
        '已核对的项目信息与响应要求：', JSON.stringify(context)
      ].join('\n')
    };
  },

  sections(elementRow, context = {}) {
    return {
      system: SYSTEM_WRITE,
      user: [
        '任务：把要素表展开成技术标正文。',
        '铁律：',
        '- 依据项目范围完整编写方案，展开工艺流程、责任岗位、检查和处置机制。合理的未来实施计划属于你应撰写的内容，应写清拟采取的安排，不得伪称已完成的事实',
        '- 每个段落都要在 covers 里标明它回应了哪些要素 id：只能填要素表中原样出现的 elementId（如 E1、E2），不得填章节名、评分项名或自造编号',
        '- 旧要素表里的段落数量、图表数量、工作步骤、检查频次、管理措施等写作任务由你完成，不得保留成用户待填。仅无法代替用户确认的真实业绩、进场安排和实测事实保留占位符',
        '- 段落里不要出现公司名、品牌名、人名（暗标）',
        '- 一段 150—300 字，用"做法 + 参数 + 频次 + 责任人岗位"的信息密度写，不要空话',
        '',
        '要素表：',
        JSON.stringify(elementRow, null, 2),
        '已核对的项目信息与响应要求（需在相关段落写明条款号）：', JSON.stringify(context)
      ].join('\n')
    };
  }
};

module.exports = { SCHEMAS, PROMPTS, SYSTEM_BASE, docBlock, pickSections, L };
