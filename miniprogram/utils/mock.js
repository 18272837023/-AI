/**
 * 测试数据层
 * 产品边界：只做技术标（施工组织设计 / 技术方案）
 * 设计依据：docs/技术标生成框架.md、docs/质量控制设计.md、docs/服务端能力层设计.md
 *
 * 数据结构对应服务端能力单元：
 *   project.modeEvidence      ← M07 大纲识别与模式判定
 *   qualifications            ← M05 合格性条款（含响应方式判定）
 *   scoreItems                ← M06 评分细则 + M09 施工图（elements）
 *   elementSheet              ← M13 要素表
 *   outline[].depend          ← M10 章节依赖分级
 *   selfCheck                 ← M17—M20 校验结果
 *   scoreIndex / reqIndex     ← M24 索引表
 */

/* ============================================================
   项目要素（M04）
   ============================================================ */
const project = {
  id: 'p_20261028_001',
  name: '十堰武当山机场零碳机场综合能源项目（一期）施工总承包',
  shortName: '武当山机场零碳项目',
  coverText: '武',
  coverColor: 'linear-gradient(135deg,#1B3A6B,#2E5C9E)',
  purchaser: '十堰武当山机场集团有限公司',
  budget: '2,860.00 万元',
  method: '公开招标',
  duration: '180 日历天',
  deadline: '2026-10-28 09:30',
  daysLeft: 11,
  bidNo: 'SYJC-2026-0917',
  quality: '合格，争创鲁班奖',
  evalMethod: '综合评分法',
  techScore: 45,
  pageLimit: '不超过 300 页',
  blind: '暗标',
  status: 'generating',
  progress: 62,

  // 项目类型：影响章节骨架与术语体系（访谈第 4 条）
  projectType: 'EPC 总承包',
  sector: '机场综合能源',
  scope: '机场综合能源站、分布式光伏 2.4MW、储能系统 1.2MWh、充电桩 46 套及配套管网',
  location: '十堰武当山机场（运行区及航站区）',

  // M07 输出：大纲约束强度 + 判定证据
  outlineMode: 'strict',
  outlineModeText: '严格按给定大纲',
  modeEvidence: {
    quote: '技术标须严格按照第六章「投标文件格式」给定的技术标目录编制，不得更改章节名称与排列顺序，否则视为无效投标。',
    src: '第二章 投标人须知 4.1.2',
    page: 'P28',
    confidence: 'high'
  },

  // M03 输出：多文件（正文 + 技术要求附件）
  files: [
    { name: '武当山机场零碳项目招标文件.pdf', size: '18.6 MB', kind: 'main', tag: '招标文件正文' },
    { name: '附件一 光伏与储能技术规格书.pdf', size: '6.2 MB', kind: 'attach', tag: '技术要求附件' }
  ]
};

/* ============================================================
   合格性条款（M05）：形式 / 资格 / 响应性
   resp 决定该条是否进入技术标生成与自检
     tech   技术标内响应 → 进生成 + 自检
     attach 需另附材料   → 报告提示，不进技术标
     none   不涉及技术标 → 直接过滤
   ============================================================ */
const qualifications = [
  {
    id: 'Q1', cat: '形式', code: '4.1.6', level: 'high', resp: 'tech',
    req: '技术标采用暗标，正文、页眉页脚、图表水印及文档属性中不得出现投标人名称、Logo、人员姓名',
    impact: '正文、页眉或图表出现公司名、人名，形式审查直接判无效',
    src: '第二章 4.1.6'
  },
  {
    id: 'Q2', cat: '形式', code: '3.2.3', level: 'mid', resp: 'tech',
    req: '技术标正文不超过 300 页（不含目录与附图），超页按每 10 页扣 0.5 分，最多扣 3 分',
    impact: '每超 10 页扣 0.5 分，最多扣 3 分',
    src: '第三章 3.2.3'
  },
  {
    id: 'Q3', cat: '响应性', code: '5.2.1', level: 'high', resp: 'tech',
    req: '★光伏组件转换效率 ≥ 22.5%，储能系统循环寿命 ≥ 6000 次，负偏离即技术标不得分',
    impact: '任一项负偏离，技术标整体不得分',
    src: '第五章 5.2.1'
  },
  {
    id: 'Q4', cat: '响应性', code: '5.4.2', level: 'high', resp: 'tech',
    req: '须单独编制不停航施工专项方案，明确分区作业时段、净空限制与应急撤离措施',
    impact: '未单独成章，该项对应分值不得分',
    src: '第五章 5.4.2'
  },
  {
    id: 'Q5', cat: '响应性', code: '1.4.1', level: 'low', resp: 'attach',
    req: '投标有效期 90 日历天，须在投标函中承诺',
    where: '投标函（商务标）中承诺，不写进技术标正文',
    impact: '投标函未承诺有效期，可能被判无效投标',
    src: '第二章 1.4.1'
  },
  {
    id: 'Q8', cat: '资格', code: '2.2.1', level: 'mid', resp: 'attach',
    req: '须提供近三年（2023 年至今）同类零碳/新能源项目合同复印件及竣工验收证明',
    where: '第七章 7.3 类似项目业绩 正文响应，并另附合同与验收证明扫描件',
    impact: '业绩材料缺失或规模不达标，技术标「类似项目经历」对应分值不得分',
    src: '第二章 2.2.1'
  },
  {
    id: 'Q6', cat: '资格', code: '2.1.3', level: 'low', resp: 'none',
    req: '具备电力工程施工总承包二级及以上资质',
    impact: '资格后审不通过，不进入技术评审',
    src: '第二章 2.1.3'
  },
  {
    id: 'Q7', cat: '资格', code: '2.1.5', level: 'low', resp: 'none',
    req: '提供近三年经审计的财务报表',
    impact: '财务报表缺失，资格后审不通过',
    src: '第二章 2.1.5'
  }
];

// 统计（页面直接用，避免在 WXML 里做复杂计算）
const qualStats = {
  total: qualifications.length,
  tech: qualifications.filter((q) => q.resp === 'tech').length,
  attach: qualifications.filter((q) => q.resp === 'attach').length,
  none: qualifications.filter((q) => q.resp === 'none').length,
  cats: ['形式', '资格', '响应性'].map((c) => ({
    name: c,
    count: qualifications.filter((q) => q.cat === c).length
  }))
};

/* ============================================================
   评分细则 + 施工图（M06 + M09）
   tier    评分档次描述 —— 这是生成标准，不是装饰
   elements 必答要素清单 —— 唯一的质量标准载体
   ============================================================ */
const scoreItems = [
  {
    id: 'S1', name: '施工组织设计', score: 12, chapter: '第二章', source: '第五章 5.4.1', depend: 'auto',
    tier: '部署合理、区段划分清晰、工序衔接紧凑且针对本项目特点的得 10—12 分；部署基本可行、针对性一般的得 6—9 分；无明确部署的得 0—5 分',
    keywords: ['分区流水', '不停航', '净空', '临时用电', '吊装'],
    elements: [
      { id: 'E1', name: '总体部署与区段划分', must: '区段数量 + 流水方向 + 交叉作业界面', done: true },
      { id: 'E2', name: '光伏与储能施工工艺', must: '组件安装工序 + 储能舱吊装 + 电缆敷设', done: true },
      { id: 'E3', name: '不停航施工组织', must: '作业时段 + 净空限制 + 撤离路线', done: true },
      { id: 'E4', name: '临时设施与用电', must: '临建面积 + 临电容量 + 电源引接点', done: true },
      { id: 'E5', name: '交叉作业协调机制', must: '协调会议频次 + 界面责任划分', done: false }
    ]
  },
  {
    id: 'S2', name: '质量保证措施', score: 8, chapter: '第三章', source: '第五章 5.5.1', depend: 'mixed',
    tier: '体系健全、控制点设置合理、检测手段明确的得 7—8 分；有体系但控制点笼统的得 4—6 分；无具体措施的得 0—3 分',
    keywords: ['质量控制点', '三检制', '见证取样', '隐蔽验收', '不合格处置'],
    elements: [
      { id: 'E1', name: '质量管理体系', must: '组织架构 + 岗位职责 + 受控文件编号', done: true },
      { id: 'E2', name: '质量控制点设置', must: '控制点清单 + 验收标准 + 责任人', done: true },
      { id: 'E3', name: '检测与试验', must: '检测项目 + 频次 + 委托机构', done: true },
      { id: 'E4', name: '隐蔽工程验收', must: '验收节点 + 记录表单 + 影像留存', done: true },
      { id: 'E5', name: '不合格品处置', must: '判定标准 + 处置流程 + 复验方式', done: true }
    ]
  },
  {
    id: 'S3', name: '安全生产与文明施工', score: 8, chapter: '第四章', source: '第五章 5.5.2', depend: 'auto',
    tier: '风险识别全面、措施可操作、应急体系完整的得 7—8 分；措施泛泛的得 4—6 分；无针对性措施的得 0—3 分',
    keywords: ['危险源', '临边防护', '高处作业', '用电安全', '应急演练'],
    elements: [
      { id: 'E1', name: '危险源辨识与分级', must: '危险源清单 + 风险等级 + 管控层级', done: true },
      { id: 'E2', name: '专项安全措施', must: '分项措施 + 防护标准 + 验收要求', done: true },
      { id: 'E3', name: '临时用电安全', must: '三级配电 + 两级保护 + 漏保参数', done: true },
      { id: 'E4', name: '应急预案与演练', must: '预案类型 + 演练频次 + 物资清单', done: true }
    ]
  },
  {
    id: 'S4', name: '进度计划与保障', score: 7, chapter: '第五章', source: '第五章 5.6.1', depend: 'auto',
    tier: '计划科学、关键线路清晰、保障措施有力的得 6—7 分；计划基本合理的得 3—5 分；无进度计划的得 0—2 分',
    keywords: ['关键线路', '里程碑', '赶工预案', '资源投入', '季节施工'],
    elements: [
      { id: 'E1', name: '总进度计划', must: '总工期 + 里程碑节点 + 关键线路', done: true },
      { id: 'E2', name: '分区进度安排', must: '各区段起止时间 + 搭接关系', done: true },
      { id: 'E3', name: '资源保障计划', must: '劳动力曲线 + 主要设备进场计划', done: true },
      { id: 'E4', name: '进度纠偏与赶工', must: '偏差阈值 + 赶工措施 + 审批流程', done: true }
    ]
  },
  {
    id: 'S5', name: '绿色施工与节能减排', score: 6, chapter: '第六章', source: '第五章 5.4.2', depend: 'auto',
    tier: '措施完善、针对性强、可操作性好的得 5—6 分；措施基本可行的得 3—4 分；无相关措施的得 0 分',
    keywords: ['零碳', '碳排因子', '光伏消纳', '储能配置', '建筑垃圾回用'],
    elements: [
      { id: 'E1', name: '碳排基线测算', must: '测算方法 + 排放因子来源 + 基线数值', done: true },
      { id: 'E2', name: '光伏与储能容量配置', must: '装机容量 + 消纳比例 + 并网方式', done: true },
      { id: 'E3', name: '施工期减排措施', must: '分项措施 + 单项减排量估算', done: true },
      { id: 'E4', name: '计量与监测', must: '计量点位 + 采集频次 + 仪表精度', done: true },
      { id: 'E5', name: '偏差处置', must: '预警阈值 + 处置流程 + 责任岗位', done: false }
    ]
  },
  {
    id: 'S6', name: '项目管理机构', score: 4, chapter: '第七章', source: '第五章 5.7.1', depend: 'company',
    tier: '机构设置合理、人员配置齐全且资历满足的得 4 分；配置基本满足的得 2—3 分；不满足最低配置的得 0 分',
    keywords: ['项目经理', '技术负责人', '专职安全员', '持证情况', '类似项目经历'],
    elements: [
      { id: 'E1', name: '组织机构设置', must: '部门设置 + 汇报关系 + 人员编制', done: true },
      { id: 'E2', name: '关键岗位配置', must: '岗位名称 + 职称 + 证书类别（不写姓名）', done: true },
    { id: 'E3', name: '类似项目经历', must: '项目类型 + 合同签订时间 + 合同金额 + 实施情况（一个合同一条）', done: false },
    { id: 'E4', name: '人员进场计划', must: '供应商进场时间 + 主要岗位到场节点 + 人数峰值 + 人员来源', done: false },
    { id: 'E5', name: '培训与考核', must: '培训对象 + 内容 + 频次学时 + 考核方式 + 不合格处置', done: false }
    ]
  }
];

// 施工图汇总（M09 输出统计）
const blueprintStats = (() => {
  let total = 0;
  let done = 0;
  scoreItems.forEach((s) => {
    total += s.elements.length;
    done += s.elements.filter((e) => e.done).length;
  });
  return { items: scoreItems.length, elements: total, done, rate: Math.round((done / total) * 100) };
})();

/* ============================================================
   要素表（M13）：以第六章为例
   conf: high 通用做法 / medium 需项目参数 / low 依赖公司信息
   ============================================================ */
const elementSheet = {
  no: '第六章',
  title: '绿色施工与零碳专项方案',
  score: 6,
  tier: '措施完善、针对性强、可操作性好的得 5—6 分；措施基本可行的得 3—4 分；无相关措施的得 0 分',
  source: '第五章 5.4.2',
  rows: [
    {
      el: 'E1', name: '碳排基线测算', conf: 'high', needUser: false,
      point: '以 2023 年为基准年，按《建筑碳排放计算标准》GB/T 51366 核算施工期碳排放',
      params: ['基准年 2023', '边界：施工 + 运输 + 临建', '因子来源：省级电网平均因子'],
      owner: '项目技术负责人', freq: '开工前 1 次，季度复核'
    },
    {
      el: 'E2', name: '光伏与储能容量配置', conf: 'high', needUser: false,
      point: '临建区布置 120kW 临时光伏阵列，配套 200kWh 储能，覆盖办公与生活区用电',
      params: ['光伏 120kW', '储能 200kWh', '消纳比例 ≥ 65%', '并网：低压并网'],
      owner: '机电负责人', freq: '全过程'
    },
    {
      el: 'E3', name: '施工期减排措施', conf: 'medium', needUser: true,
      point: '土方与吊装环节优先采用电动设备，替代柴油机械',
      params: ['〔待确认：现场临时用电容量〕', '替代柴油设备 6 台', '预计减排 54 吨 CO₂e'],
      owner: '设备管理员', freq: '全过程'
    },
    {
      el: 'E4', name: '计量与监测', conf: 'medium', needUser: true,
      point: '在临建配电箱、光伏并网点、储能出口设置计量表，接入机场能源管理平台',
      params: ['〔待确认：平台对接协议〕', '计量点位 8 处', '采集频次 15 分钟', '仪表精度 0.5S 级'],
      owner: '绿色施工管理员', freq: '日巡查、周统计、月分析'
    },
    {
      el: 'E5', name: '偏差处置', conf: 'high', needUser: false,
      point: '月度碳排实测值超过目标值 10% 时启动纠偏',
      params: ['预警阈值 +10%', '纠偏 7 日内闭环', '责任岗位：项目经理'],
      owner: '项目经理', freq: '月度'
    }
  ]
};

/* ============================================================
   技术标大纲（M11）：strict 模式，全部锁定
   depend: auto 全自动 / company 需企业信息 / mixed 混合
   ============================================================ */
const outline = [
  { no: '第一章', title: '项目理解与总体思路', score: 8, words: 2800, depend: 'auto', elDone: 5, elTotal: 5, locked: true, subs: [] },
  {
    no: '第二章', title: '施工组织设计与部署', score: 12, words: 6500, depend: 'auto', elDone: 4, elTotal: 5, locked: true,
    subs: ['2.1 施工总体部署与区段划分', '2.2 光伏与储能系统施工方案', '2.3 不停航施工专项措施']
  },
  { no: '第三章', title: '质量保证体系与措施', score: 8, words: 5200, depend: 'mixed', elDone: 5, elTotal: 5, locked: true, subs: [] },
  { no: '第四章', title: '安全生产与文明施工', score: 8, words: 5000, depend: 'auto', elDone: 4, elTotal: 4, locked: true, subs: [] },
  { no: '第五章', title: '进度计划与保障措施', score: 7, words: 4600, depend: 'auto', elDone: 4, elTotal: 4, locked: true, subs: [] },
  { no: '第六章', title: '绿色施工与零碳专项方案', score: 6, words: 4000, depend: 'auto', elDone: 4, elTotal: 5, locked: true, subs: [] },
  { no: '第七章', title: '项目管理机构与人员配置', score: 4, words: 2400, depend: 'company', elDone: 2, elTotal: 5, locked: true, subs: [] },
  { no: '第八章', title: '服务承诺与售后保障', score: 0, words: 1800, depend: 'mixed', elDone: 3, elTotal: 3, locked: true, subs: [] }
];

const outlineStats = {
  chapters: outline.length,
  words: '4.2',
  score: 45,
  elementsDone: outline.reduce((a, c) => a + c.elDone, 0),
  elementsTotal: outline.reduce((a, c) => a + c.elTotal, 0)
};

/* ============================================================
   生成任务（M13 → M14 两段式）
   phase: sheet 出要素表 / write 展开正文
   ============================================================ */
const chapters = [
  { index: 1, title: '第一章 项目理解与总体思路', words: 2800, els: 5, depend: 'auto' },
  { index: 2, title: '第二章 施工组织设计与部署', words: 6500, els: 5, depend: 'auto' },
  { index: 3, title: '第三章 质量保证体系与措施', words: 5200, els: 5, depend: 'mixed' },
  { index: 4, title: '第四章 安全生产与文明施工', words: 5000, els: 4, depend: 'auto' },
  { index: 5, title: '第五章 进度计划与保障措施', words: 4600, els: 4, depend: 'auto' },
  { index: 6, title: '第六章 绿色施工与零碳专项方案', words: 4000, els: 5, depend: 'auto' },
  { index: 7, title: '第七章 项目管理机构与人员配置', words: 2400, els: 5, depend: 'company' },
  { index: 8, title: '第八章 服务承诺与售后保障', words: 1800, els: 3, depend: 'mixed' }
];

/* ============================================================
   待补字段清单（M12 素材装配 → M13 要素表的 user 输入部分）
   company 章节不写正文，改出字段表。字段跨章节合并同类项。

   field.type
     text   普通输入
     chips  固定选项（项目类型、实施情况这类枚举，必须收敛，不能自由填）
     label  小标题（不占字段数，只用来把框架分段）
   field.value  预置测试数据；新增条目一律为空
   group.repeat / max  可加多条；group.aiPolish 该组支持「AI 润色」自动生成
   ============================================================ */
const fillItems = [
  {
    id: 'F1',
    el: 'E3',
    chapter: '第七章 项目管理机构与人员配置',
    name: '类似项目经历',
    hint: '一个合同填一条。项目类型从固定选项里选，金额与时间按合同原文抄。近三年（2023 年至今）优先，已完成项目得分更高。',
    canDeclare: true,
    repeat: true,
    unit: '项目',
    max: 6,
    fields: [
      { key: 'type', label: '项目类型', ph: '如：机场综合能源 / 光伏电站 EPC', value: '机场综合能源' },
      { key: 'signDate', label: '合同签订时间', ph: '如：2023-06', value: '2023-06' },
      { key: 'amount', label: '合同金额（万元）', ph: '如：2860', value: '2860' },
      {
        key: 'status', label: '实施情况', type: 'chips', value: '已完成',
        options: ['已完成', '在建', '已中标未开工']
      }
    ]
  },
  {
    id: 'F2',
    el: 'E4',
    chapter: '第七章 项目管理机构与人员配置',
    name: '人员进场计划',
    hint: '人数与工期要能对上进度计划，否则评委会认为资源投入不实。岗位节点按实际填，写「开工前 N 日」即可。',
    canDeclare: true,
    repeat: false,
    fields: [
      { key: 'vendor', label: '供应商进场时间', ph: '如：开工前 7 日', value: '开工前 7 日' },
      { key: 'peak', label: '现场作业人数峰值', ph: '如：86', value: '86' },
      { key: 'source', label: '人员来源', ph: '如：自有 60% + 劳务 40%', value: '自有 60% + 劳务 40%' },
      { key: '_posts', type: 'label', text: '主要岗位到场节点' },
      { key: 'pm', label: '项目经理', ph: '如：开工前 7 日', value: '开工前 7 日' },
      { key: 'tech', label: '技术负责人', ph: '如：开工前 5 日', value: '开工前 5 日' },
      { key: 'safe', label: '专职安全员', ph: '如：开工前 3 日', value: '开工前 3 日' },
      { key: 'spec', label: '特种作业人员', ph: '如：分项开工前 2 日', value: '分项开工前 2 日' }
    ]
  },
  {
    id: 'F3',
    el: 'E5',
    chapter: '第七章 项目管理机构与人员配置',
    name: '培训与考核',
    hint: '一个培训维度填一条（对象不同就算一条）。不想逐条写，点「AI 润色」按本项目类型自动拆 2—6 条，生成后可自行增删改。',
    canDeclare: true,
    repeat: true,
    unit: '培训维度',
    max: 6,
    aiPolish: true,
    fields: [
      { key: 'subject', label: '培训对象', ph: '如：全体进场人员', value: '全体进场人员' },
      { key: 'content', label: '培训内容', ph: '如：不停航施工规程、储能安装工艺', value: '不停航施工规程、储能安装工艺' },
      { key: 'freq', label: '频次与学时', ph: '如：入场教育 1 次（4 学时）+ 月度专题', value: '入场教育 1 次（4 学时）+ 月度专题' },
      { key: 'check', label: '考核方式', ph: '如：闭卷考试 80 分合格 + 实操抽查', value: '闭卷考试 80 分合格 + 实操抽查' },
      { key: 'fail', label: '不合格处置', ph: '如：补考 1 次，仍不合格清退出场', value: '补考 1 次，仍不合格清退出场' }
    ]
  },
  {
    id: 'F4',
    el: 'E4',
    chapter: '第六章 绿色施工与零碳专项方案',
    name: '现场与外部条件',
    hint: '这两项招标文件没写、只有你知道。填了，正文里的「待确认」占位符会自动替换，不必再回正文改。',
    canDeclare: false,
    repeat: false,
    fields: [
      { key: 'power', label: '现场临时用电容量', ph: '如：400kVA，双回路，自备 200kW 发电机', value: '400kVA，双回路，自备 200kW 发电机' },
      { key: 'api', label: '能源管理平台对接方式', ph: '如：Modbus TCP 接入甲方平台，提供 API 文档', value: 'Modbus TCP 接入甲方平台，提供点表与 API 文档' }
    ]
  }
];

/* ============================================================
   「AI 润色」预置：按项目类型拆培训维度
   真实实现由 LLM 读项目要素 + 施工图 + 已生成正文后生成 2—6 条
   ============================================================ */
const trainingDims = {
  '机场综合能源': [
    {
      subject: '全体进场人员',
      content: '不停航施工规程、净空与限高管理、机坪通行证制度',
      freq: '入场教育 1 次（4 学时）+ 每周班前会',
      check: '闭卷考试 80 分合格',
      fail: '补考 1 次，仍不合格清退出场'
    },
    {
      subject: '光伏与储能安装班组',
      content: '组件吊装与支架安装工艺、储能舱就位接线、防逆流保护',
      freq: '分项开工前 1 次（2 学时）',
      check: '实操考核 + 首件样板验收',
      fail: '重新培训后复考，两次不合格调岗'
    },
    {
      subject: '特种作业人员（电工/焊工/起重）',
      content: '临时用电、高处作业、动火作业规程',
      freq: '每季度 1 次（2 学时）',
      check: '证件复核 + 现场实操抽查',
      fail: '暂停作业资格，重新取证后上岗'
    },
    {
      subject: '项目管理人员',
      content: '危大工程管控、应急撤离与消防演练',
      freq: '每月 1 次（1 学时）',
      check: '演练评估表 + 现场提问',
      fail: '纳入月度绩效，连续两次不合格换岗'
    }
  ]
};

const trainingDimsDefault = [
  {
    subject: '全体进场人员',
    content: '项目概况、施工工艺、安全文明施工要求',
    freq: '入场教育 1 次（4 学时）',
    check: '闭卷考试 80 分合格',
    fail: '补考 1 次，仍不合格清退出场'
  },
  {
    subject: '特种作业人员',
    content: '临时用电、高处作业、动火作业规程',
    freq: '每季度 1 次（2 学时）',
    check: '证件复核 + 实操抽查',
    fail: '暂停作业资格，重新取证后上岗'
  },
  {
    subject: '项目管理人员',
    content: '危大工程管控、应急处置流程',
    freq: '每月 1 次（1 学时）',
    check: '现场提问考核',
    fail: '纳入月度绩效'
  }
];

/* ---------- 待补字段：工厂 + 跨页状态 ---------- */

// label 只是分段小标题，不算字段
function isInputField(f) {
  return f.type !== 'label';
}

function makeField(f, withValue) {
  return {
    key: f.key,
    label: f.label || '',
    text: f.text || '',
    type: f.type || 'text',
    options: f.options || [],
    ph: f.ph || '',
    value: withValue ? (f.value || '') : ''
  };
}

function makeEntry(g, seq, withValue) {
  return {
    id: g.id + '-' + seq,
    fields: g.fields.map((f) => makeField(f, withValue))
  };
}

function createFillGroups() {
  return fillItems.map((g) => ({
    id: g.id,
    el: g.el,
    chapter: g.chapter,
    name: g.name,
    hint: g.hint,
    canDeclare: g.canDeclare,
    repeat: !!g.repeat,
    unit: g.unit || '项',
    max: g.max || 1,
    aiPolish: !!g.aiPolish,
    declared: false,
    entries: [makeEntry(g, 1, true)]
  }));
}

function countFillFields(groups) {
  let n = 0;
  groups.forEach((g) => {
    g.entries.forEach((e) => {
      n += e.fields.filter(isInputField).length;
    });
  });
  return n;
}

function countFillDone(groups) {
  let n = 0;
  groups.forEach((g) => {
    if (g.declared) return;
    g.entries.forEach((e) => {
      e.fields.forEach((f) => {
        if (isInputField(f) && f.value && f.value.trim()) n += 1;
      });
    });
  });
  return n;
}

// 未填完且未声明缺失的组数 —— 这些在自检里是阻断项
function countFillPending(groups) {
  return groups.filter(
    (g) =>
      !g.declared &&
      g.entries.some((e) =>
        e.fields.some((f) => isInputField(f) && !(f.value || '').trim())
      )
  ).length;
}

const fillStats = {
  groups: fillItems.length,
  fields: fillItems.reduce(
    (a, g) => a + g.fields.filter(isInputField).length,
    0
  ),
  filled: 0,
  declared: 0
};

/* 待补字段页的编辑态，来回切页不丢已输入内容 */
const fillStore = { groups: createFillGroups() };

/* 跨页状态：待补字段页写入，自检页读取 */
const fillState = {
  pending: countFillPending(fillStore.groups),
  filled: countFillDone(fillStore.groups),
  declared: 0
};

function commitFill(groups) {
  fillStore.groups = groups;
  fillState.pending = countFillPending(groups);
  fillState.filled = countFillDone(groups);
  fillState.declared = groups.filter((g) => g.declared).length;
}

function resetFill() {
  fillStore.groups = createFillGroups();
  commitFill(fillStore.groups);
}

/* 自检页已修复的项（一键修复后置位） */
const checkState = { resolved: {} };

/* ============================================================
   章节正文（第六章）
   blocks.type: h4 / p / quote / ph（占位符）
   ============================================================ */
const chapterContent = {
  no: '第六章',
  title: '第六章　绿色施工与零碳专项方案',
  wordCount: 1286,
  score: 6,
  tier: '措施完善、针对性强、可操作性好的得 5—6 分',
  elements: [
    { id: 'E1', name: '碳排基线测算', done: true },
    { id: 'E2', name: '光伏与储能配置', done: true },
    { id: 'E3', name: '施工期减排措施', done: true },
    { id: 'E4', name: '计量与监测', done: true },
    { id: 'E5', name: '偏差处置', done: false }
  ],
  blocks: [
    { type: 'h4', text: '6.1 绿色施工目标与总体思路', el: 'E1' },
    {
      type: 'p', el: 'E1',
      text: '本项目以「零碳机场」为建设目标，绿色施工既是招标文件的强制性要求，也是本项目技术方案的核心竞争力。依据《建筑工程绿色施工规范》GB/T 50905 与《民用机场绿色建设指南》，围绕节能、节水、节材、节地、环境保护五要素，建立覆盖施工准备至竣工验收全周期的绿色施工管理体系。'
    },
    {
      type: 'p', el: 'E1',
      text: '针对光伏装机 2.4MW、储能 1.2MWh 的能源系统特点，将绿色施工与能源系统调试深度耦合：施工期引入临时光伏供电与储能调峰，实现施工用电清洁化替代，预计施工期碳减排量 186 吨 CO₂e。'
    },
    {
      type: 'quote', el: 'E1',
      text: '响应第五章 5.4.2 条：承包人应编制绿色施工专项方案，明确碳减排测算方法及数据来源。'
    },
    { type: 'h4', text: '6.2 碳减排测算与实施路径', el: 'E2' },
    {
      type: 'p', el: 'E2',
      text: '采用《建筑碳排放计算标准》GB/T 51366 规定的核算方法，以施工机械能耗、临时用电、材料运输、废弃物处置四类排放源为边界建立基线模型。经测算，施工期基准碳排放约 1,240 吨 CO₂e，通过四条路径可实现减排 38.6%：'
    },
    { type: 'p', el: 'E3', text: '（1）临时用电清洁化：临建区布置 120kW 临时光伏阵列，配套 200kWh 储能，覆盖办公区、生活区及部分施工机械用电，预计减排 92 吨；' },
    { type: 'ph', el: 'E3', text: '〔待确认：现场临时用电容量〕' },
    { type: 'p', el: 'E3', text: '（2）施工机械电动化：土方及吊装优先采用电动挖掘机、电动汽车吊，替代柴油设备 6 台，预计减排 54 吨；' },
    { type: 'p', el: 'E3', text: '（3）材料本地化采购：光伏组件与储能设备运输半径控制在 300km 内，预计减排 21 吨；' },
    { type: 'p', el: 'E3', text: '（4）废弃物资源化：建筑垃圾现场破碎回用率不低于 60%，预计减排 19 吨。' },
    { type: 'h4', text: '6.3 组织保障与监测机制', el: 'E4' },
    {
      type: 'p', el: 'E4',
      text: '项目部设绿色施工管理小组，项目经理任组长，配专职绿色施工管理员 1 名，建立「日巡查、周统计、月分析」的碳排放监测机制。在临建配电箱、光伏并网点、储能出口设计量表共 8 处，采集频次 15 分钟，仪表精度 0.5S 级，数据接入机场能源管理平台。'
    },
    {
      type: 'ph', el: 'E4',
      text: '〔待确认：能源管理平台对接协议与数据接口规范〕'
    },
    {
      type: 'p', el: 'E5',
      text: '月度碳排实测值超过目标值 10% 时，由项目经理在 7 日内组织纠偏并闭环；连续两个月超阈值，报公司技术中心介入。'
    }
  ]
};

/* ============================================================
   三重自检结果（M17—M20）
   level: block 阻断 / warn 警告 / pass 通过
   fixType: auto 一键修复（AI 能写） / manual 必须用户给事实（跳页填写）
   ============================================================ */
const selfCheck = {
  blocking: 3,
  warning: 2,
  passed: 4,
  items: [
    {
      id: 'C1', cat: '合格性覆盖', level: 'block',
      title: '1 条合格性条款无对应响应',
      detail: 'Q4「须单独编制不停航施工专项方案」在第二章 2.3 只以段落提及，未写分区作业时段与撤离路线。',
      loc: '第二章 2.3',
      fixType: 'auto', fixLabel: 'AI 补写', fixPage: 'chapter',
      steps: [
        '在 2.3 节后补 3 段：分区作业时段、人员车辆撤离路线、与停航窗口的衔接',
        '补写后自动重算 Q4 覆盖状态，无需你再判断'
      ]
    },
    {
      id: 'C2', cat: '要素覆盖', level: 'block',
      title: 'E5 偏差处置未覆盖完整要素',
      detail: '第六章已写预警阈值与责任岗位，缺「处置流程」的具体步骤。',
      loc: '第六章 6.3',
      fixType: 'auto', fixLabel: 'AI 补写要素', fixPage: 'chapter',
      steps: [
        '按要素表补「处置流程」：发现 → 上报 → 处置 → 复核 四步',
        '每步写清责任岗位与时限，不是补一段套话'
      ]
    },
    {
      id: 'C3', cat: '占位残留', level: 'block',
      title: '2 处占位符未清零',
      detail: '〔待确认：现场临时用电容量〕、〔待确认：能源管理平台对接协议与数据接口规范〕',
      loc: '第六章 6.2 / 6.3',
      fixType: 'manual', fixLabel: '去填写', fixPage: 'fill',
      steps: [
        '这 2 处是招标文件没写、只有你知道的事实，AI 不能编',
        '在「待补字段」的「现场与外部条件」里填 2 个字段，正文自动替换'
      ]
    },
    {
      id: 'C4', cat: '文风检测', level: 'warn',
      title: '参数密度偏低（9.2 / 千字）',
      detail: '目标值 ≥ 12。第三章、第八章存在连续 3 段以上无具体参数的表述。',
      loc: '第三章 3.2',
      fixType: 'auto', fixLabel: 'AI 加参数', fixPage: 'chapter',
      steps: [
        '为 6 处空泛表述补具体数值（间距、时限、精度、人数）',
        '只补参数不改结论，避免前后矛盾'
      ]
    },
    {
      id: 'C5', cat: '文风检测', level: 'warn',
      title: '命中 3 处空话表述',
      detail: '「高度重视」「切实加强」「确保万无一失」各 1 处。',
      loc: '第四章 4.1',
      fixType: 'auto', fixLabel: 'AI 替换', fixPage: 'chapter',
      steps: [
        '替换为可核查的动作 + 责任岗位 + 频次',
        '例：「高度重视」→「每周由安全总监组织 1 次专项检查」'
      ]
    },
    {
      id: 'C6', cat: '合规核验', level: 'pass',
      title: '暗标词表检查通过',
      detail: '全文未检出公司名、人名、电话、网址、Logo 描述。'
    },
    {
      id: 'C7', cat: '合规核验', level: 'pass',
      title: '规范号白名单检查通过',
      detail: '引用 GB/T 50905、GB/T 51366、GB 55015 共 3 个编号，均在白名单内。'
    },
    {
      id: 'C8', cat: '合规核验', level: 'pass',
      title: '页数核算通过',
      detail: '当前 186 页，招标上限 300 页，余量 114 页。'
    },
    {
      id: 'C9', cat: '章节骨架', level: 'pass',
      title: '大纲与招标文件一致',
      detail: '8 章标题与第六章「投标文件格式」逐字比对一致（strict 模式）。'
    }
  ]
};

/* ============================================================
   自检结果计算 —— 自检页与导出页共用同一份逻辑
   导出页如果自己读 selfCheck 的静态 blocking，用户修完后门禁不会跟着变
   ============================================================ */
const CHECK_ORDER = { block: 0, warn: 1, pass: 2 };

function fillCheckItem() {
  const st = fillState;
  if (st.pending > 0) {
    return {
      id: 'C0',
      cat: '必填字段',
      level: 'block',
      title: st.pending + ' 组字段未完成',
      detail:
        '这些内容依赖你公司的真实信息（业绩、人员、现场条件），AI 不会编造，' +
        '缺失将导致对应评分项无法得分。',
      loc: '待补字段',
      fixType: 'manual',
      fixLabel: '去填写',
      fixPage: 'fill',
      steps: [
        '进入「待补字段」，逐组填写；数量不限，可加多个项目',
        '确实没有的（如类似业绩）可点「确认无此项」声明缺失',
        '填完回来点「重新自检」，该项自动转通过'
      ]
    };
  }
  if (st.declared > 0) {
    return {
      id: 'C0',
      cat: '必填字段',
      level: 'warn',
      title: st.declared + ' 组字段已声明缺失',
      detail: '这些要素不会出现在正文中，对应评分项预计拿不到该部分分数，但不阻塞导出。',
      loc: '待补字段',
      fixType: 'manual',
      fixLabel: '再确认',
      fixPage: 'fill',
      steps: ['如果后来拿到业绩材料，可以回来补填', '补填后该项自动转通过']
    };
  }
  return {
    id: 'C0',
    cat: '必填字段',
    level: 'pass',
    title: '必填字段已全部完成',
    detail: '已填 ' + st.filled + ' 个字段，将由 AI 织入正文。'
  };
}

// 「现场与外部条件」填完，正文里的 2 处占位符就被替换了
function externalDone() {
  const g = (fillStore.groups || []).filter((x) => x.id === 'F4')[0];
  if (!g || g.declared) return false;
  return g.entries.every((e) =>
    e.fields.every((f) => f.type === 'label' || (f.value || '').trim())
  );
}

function buildCheck() {
  const list = [fillCheckItem()];

  selfCheck.items.forEach((it) => {
    if (it.id === 'C3' && externalDone()) {
      list.push({
        ...it,
        level: 'pass',
        resolved: true,
        fixType: '',
        fixLabel: '',
        detail: '2 处占位符已按你在「现场与外部条件」填的内容替换，正文里不再有〔待确认〕。'
      });
      return;
    }

    if (checkState.resolved[it.id]) {
      list.push({
        ...it,
        level: 'pass',
        resolved: true,
        fixType: '',
        fixLabel: '',
        detail: '已由 AI 处理（' + it.fixLabel + '），可点「重新自检」复核。'
      });
    } else {
      list.push({ ...it });
    }
  });

  list.sort((a, b) => CHECK_ORDER[a.level] - CHECK_ORDER[b.level]);

  const open = list.filter((it) => it.level !== 'pass');
  const blocking = list.filter((it) => it.level === 'block');
  const warning = list.filter((it) => it.level === 'warn');

  return {
    items: list,
    blocking: blocking.length,
    warning: warning.length,
    passed: list.filter((it) => it.level === 'pass').length,
    manual: open.filter((it) => it.fixType === 'manual').length,
    auto: open.filter((it) => it.fixType === 'auto').length,
    blockingCats: blocking.map((it) => it.cat)
  };
}

// 导出页门禁文案
function gateOf(check) {
  if (check.blocking > 0) {
    return {
      gateTitle: '存在 ' + check.blocking + ' 项阻断，暂不可导出',
      gateDesc: check.blockingCats.join('、') + '需先清零'
    };
  }
  if (check.warning > 0) {
    return {
      gateTitle: '自检通过，可以导出',
      gateDesc: '还有 ' + check.warning + ' 项警告，不阻塞导出，建议导出前看一眼'
    };
  }
  return {
    gateTitle: '自检通过，可以导出',
    gateDesc: '阻断与警告均已清零'
  };
}

/* ============================================================
   导出索引表（M24）
   ============================================================ */
const scoreIndex = [
  { item: '施工组织设计', score: 12, chapter: '第二章 2.1—2.3', page: 'P12', quote: '采用分区流水施工，光伏区与储能区分三段推进' },
  { item: '质量保证措施', score: 8, chapter: '第三章 3.1—3.4', page: 'P38', quote: '设 6 个质量控制点，执行三检制与见证取样' },
  { item: '安全生产与文明施工', score: 8, chapter: '第四章 4.1—4.3', page: 'P52', quote: '辨识危险源 27 项，其中重大危险源 3 项' },
  { item: '进度计划与保障', score: 7, chapter: '第五章 5.1—5.3', page: 'P68', quote: '总工期 180 天，设 6 个里程碑节点' },
  { item: '绿色施工与节能减排', score: 6, chapter: '第六章 6.1—6.3', page: 'P82', quote: '基准碳排 1,240 吨，减排 38.6%' },
  { item: '项目管理机构', score: 4, chapter: '第七章 7.1—7.2', page: 'P96', quote: '配项目经理 1 名、技术负责人 1 名、专职安全员 2 名' }
];

const reqIndex = [
  { code: '5.2.1', req: '光伏组件效率 ≥ 22.5%', loc: '2.2.3', resp: '选用 N 型 TOPCon 组件，效率 22.8%' },
  { code: '5.2.1', req: '储能循环寿命 ≥ 6000 次', loc: '2.2.4', resp: '磷酸铁锂系统，循环寿命 8000 次' },
  { code: '5.4.2', req: '不停航施工专项方案', loc: '2.3', resp: '分区作业时段、净空限制、撤离路线已明确' },
  { code: '5.4.2', req: '绿色施工专项方案与碳排测算', loc: '6.1—6.3', resp: '核算方法、边界、减排量均已量化' }
];

/* ============================================================
   其他
   ============================================================ */
const projectList = [
  {
    id: 'p1', coverText: '武', coverColor: 'linear-gradient(135deg,#1B3A6B,#2E5C9E)',
    name: '武当山机场零碳机场综合能源项目', status: 'generating', statusText: '自检中 3 项阻断',
    tagType: 'red', updateText: '10-28 截止', progress: 62, progressColor: '#165DFF'
  },
  {
    id: 'p2', coverText: '客', coverColor: 'linear-gradient(135deg,#0E5C4A,#1A8A6D)',
    name: '客运站片区老旧小区改造项目', status: 'done', statusText: '待导出',
    tagType: 'orange', updateText: '10-15 更新', progress: 100, progressColor: '#FF7D00'
  },
  {
    id: 'p3', coverText: '市', coverColor: 'linear-gradient(135deg,#5B3AA8,#7C5BD0)',
    name: '某市政道路提升改造工程', status: 'exported', statusText: '已导出',
    tagType: 'green', updateText: '09-28 完成', progress: 0
  },
  {
    id: 'p4', coverText: '医', coverColor: 'linear-gradient(135deg,#8A4B12,#C07A2E)',
    name: '某三甲医院智能化系统集成项目', status: 'exported', statusText: '已导出',
    tagType: 'green', updateText: '09-12 完成', progress: 0
  }
];

// 技术素材：只收技术类，且标注是否含身份信息（暗标闸门）
const materials = [
  { name: '光伏电站施工工艺标准', meta: '企业版 · 38 页 · 已脱敏', type: 'DOC', typeColor: '#165DFF', typeBg: '#EAF1FF', status: '已入库', statusType: 'green', safe: true },
  { name: '不停航施工专项方案', meta: '机场类 3 个 · 已脱敏', type: 'DOC', typeColor: '#165DFF', typeBg: '#EAF1FF', status: '已入库', statusType: 'green', safe: true },
  { name: '储能系统设备参数表', meta: '设备参数 · 含厂商标识', type: 'XLS', typeColor: '#00B42A', typeBg: '#E8FFEA', status: '待脱敏', statusType: 'orange', safe: false },
  { name: '施工现场实景图', meta: '36 张 · 已打标', type: 'IMG', typeColor: '#86909C', typeBg: '#F2F3F5', status: '已入库', statusType: 'green', safe: true }
];

const plans = [
  { id: 'single', name: '单份导出', desc: '仅本项目 · 永久可下载', price: 39, origin: 69, rec: false },
  { id: 'month', name: '专业月卡', desc: '30 天内不限份数 · 无水印导出', price: 199, origin: 299, rec: true },
  { id: 'year', name: '企业年卡', desc: '5 个席位 · 技术素材库共享 · 专属客服', price: 999, origin: 1999, rec: false }
];

module.exports = {
  project,
  qualifications,
  qualStats,
  scoreItems,
  blueprintStats,
  elementSheet,
  outline,
  outlineStats,
  chapters,
  chapterContent,
  fillItems,
  trainingDims,
  trainingDimsDefault,
  fillStats,
  fillState,
  fillStore,
  createFillGroups,
  commitFill,
  resetFill,
  countFillFields,
  countFillDone,
  countFillPending,
  isInputField,
  checkState,
  selfCheck,
  buildCheck,
  gateOf,
  scoreIndex,
  reqIndex,
  projectList,
  materials,
  plans
};
