'use strict';

/**
 * 生成一份可用的示例招标文件（DOCX + TXT）。
 * 目的不是"像真的"，而是覆盖 P0 需要识别的结构：
 * 章标题、项目要素、合格性条款（三种响应方式）、技术标评分表、格式要求。
 *
 *   node scripts/make-samples.js
 */

const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const OUT_DIR = path.resolve(__dirname, '..', 'samples');

const DOC = [
  ['h1', '第一章 招标公告'],
  ['p', '项目名称：滨江国际机场综合能源站工程'],
  ['p', '建设地点：滨江新区空港大道 88 号机场西侧'],
  ['p', '招标范围：新建综合能源站一座，含 2.4MW 分布式光伏、1.2MWh 储能系统、能源站房 1860 平方米、站内管网及配套电气工程，以及系统联调与试运行。'],
  ['p', '计划工期：210 日历天，计划开工日期 2026 年 12 月 1 日，计划竣工日期 2027 年 6 月 28 日。'],
  ['p', '质量目标：符合国家现行验收规范合格标准，一次验收合格率 100%，争创省级优质工程。'],
  ['p', '本项目采用 EPC 总承包模式，承包范围包括设计、采购、施工、调试全过程。'],

  ['h1', '第二章 投标人须知前附表'],
  ['p', '1.1 投标人应当具备电力工程施工总承包二级及以上资质，并提供资质证书副本复印件加盖公章。'],
  ['p', '1.2 投标人须提供近三年（2023 年至今）单项合同金额不低于 2000 万元的类似项目业绩不少于 2 项，随投标文件另附合同复印件。'],
  ['p', '1.3 拟派项目经理应当具备机电工程专业一级注册建造师执业资格，且未担任其他在建项目的项目经理。'],
  ['p', '1.4 投标人须提供拟派项目管理人员近三个月社保缴纳证明原件扫描件。'],
  ['p', '1.5 投标文件应当按第五章规定的格式编制，正本一份、副本四份，逐页编制页码并装订成册。'],
  ['p', '1.6 投标文件须由法定代表人或其授权代理人签字并加盖单位公章，未按要求签字盖章的投标文件无效。'],
  ['p', '1.7 投标文件应当密封包装，封口处加盖投标人公章，未密封的投标文件不予接收。'],
  ['p', '1.8 投标人应当在投标截止时间前提交投标保证金人民币 50 万元，未提交投标保证金的投标无效。'],
  ['p', '1.9 技术标应当实质性响应招标文件第五章技术要求，不得出现负偏离。'],
  ['p', '1.10 投标报价不得高于最高投标限价 8600 万元，超过最高投标限价的投标将被否决。'],
  ['p', '1.11 技术标采用暗标评审，投标文件中不得出现投标人名称、商标、品牌标识及其他可识别投标人身份的标记。'],

  ['h1', '第三章 评标办法'],
  ['p', '本项目采用综合评估法，总分 100 分，其中技术标 60 分、商务标 20 分、投标报价 20 分。'],
  ['p', '技术标评分标准如下，各评分项均按档次打分，缺项按最低档计分。'],
  ['p', '施工组织设计总体方案 15分：总体思路清晰、覆盖全部工程内容、技术路线合理得 13—15 分；思路基本清晰、覆盖主要工程内容得 9—12 分；思路笼统、覆盖不全得 5—8 分。'],
  ['p', '质量管理体系与措施 10分：质量目标明确、三检制与隐蔽验收可操作得 9—10 分；有体系但措施笼统得 6—8 分；缺项得 0—5 分。'],
  ['p', '安全管理体系与危大工程措施 10分：危险源清单完整、危大工程专项方案齐全得 9—10 分；清单不全得 6—8 分；缺项得 0—5 分。'],
  ['p', '施工进度计划与保证措施 8分：关键线路清晰、资源投入与进度匹配得 7—8 分；计划笼统得 4—6 分；缺项得 0—3 分。'],
  ['p', '绿色施工与环境保护措施 7分：扬尘噪声控制有量化指标、能耗监测有具体做法得 6—7 分；措施笼统得 3—5 分；缺项得 0—2 分。'],
  ['p', '项目管理机构与人员配置 5分：机构健全、关键岗位持证且进场计划明确得 5 分；配置不全得 2—4 分；缺项得 0—1 分。'],
  ['p', '重点难点分析与技术对策 5分：识别出光伏与储能协同、不停航施工等关键难点并给出可执行对策得 5 分；分析泛泛得 2—4 分；缺项得 0—1 分。'],

  ['h1', '第四章 技术要求'],
  ['p', '4.1 光伏系统：装机容量 2.4MW，采用单晶硅双面组件，逆变器效率不低于 98.5%，系统效率不低于 82%。'],
  ['p', '4.2 储能系统：容量 1.2MWh，充放电循环效率不低于 88%，需具备削峰填谷与并网切换功能。'],
  ['p', '4.3 能源站房：建筑面积 1860 平方米，结构形式为钢筋混凝土框架，抗震设防烈度 7 度。'],
  ['p', '4.4 施工期间机场正常运行，飞行区侧施工须执行不停航施工管理规定，每日施工窗口为 01:00—05:00。'],
  ['p', '4.5 临时用电：现场设置 400kVA 临时箱变一座，双回路供电，自备 200kW 发电机作为备用电源。'],
  ['p', '4.6 本工程技术标准执行 GB 50300、GB 50243、GB 50194、JGJ 59 及《民用机场绿色建设指南》。'],

  ['h1', '第五章 投标文件格式'],
  ['p', '5.1 技术标应当按照下列章节顺序编制，章节标题不得增删或修改：'],
  ['p', '（一）施工组织设计总体方案；（二）质量管理体系与措施；（三）安全管理体系与危大工程措施；（四）施工进度计划与保证措施；（五）绿色施工与环境保护措施；（六）项目管理机构与人员配置；（七）重点难点分析与技术对策。'],
  ['p', '5.2 技术标采用 A4 纸双面打印，正文小四号宋体，行距 1.5 倍，总页数不超过 180 页。'],
  ['p', '5.3 技术标不得编制目录页以外的彩色插页，不得使用彩色图片。']
];

const H1 = (t) => t.replace(/^第[一二三四五六七八九十]+章\s*/, '');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraph(text, opts) {
  const o = opts || {};
  const pPr = o.heading
    ? '<w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="120"/></w:pPr>'
    : '<w:pPr><w:spacing w:after="80" w:line="360" w:lineRule="auto"/></w:pPr>';
  return `<w:p>${pPr}<w:r><w:rPr>${o.heading ? '<w:b/><w:sz w:val="32"/>' : '<w:sz w:val="24"/>'}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function buildDocumentXml() {
  const body = DOC.map(([kind, text]) => paragraph(text, { heading: kind === 'h1' })).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.folder('_rels').file('.rels', RELS);
  zip.folder('word').file('document.xml', buildDocumentXml());
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const docx = path.join(OUT_DIR, '示例招标文件.docx');
  fs.writeFileSync(docx, buf);

  const txt = path.join(OUT_DIR, '示例招标文件.txt');
  fs.writeFileSync(txt, DOC.map(([, t]) => t).join('\n\n'), 'utf8');

  console.log('已生成：');
  console.log('  ' + docx + '  ' + (buf.length / 1024).toFixed(0) + 'KB');
  console.log('  ' + txt);
  console.log('章节：' + DOC.filter(([k]) => k === 'h1').map(([, t]) => H1(t)).join(' / '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
