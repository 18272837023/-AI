'use strict';

/**
 * 命令行跑全链：不启服务、不用小程序，直接看 P0 五步的产出。
 *
 *   node cli.js run samples/示例招标文件.docx
 *   node cli.js run samples/示例招标文件.docx --json out.json
 *
 * 用途：拿真实招标文件验证"AI 拆出来的要素够不够内行用"——这是 P0 唯一要回答的问题。
 */

const fs = require('node:fs');
const path = require('node:path');

const config = require('./src/config');
const store = require('./src/lib/store');
const queue = require('./src/lib/queue');
const pipeline = require('./src/pipeline/run');
const { detectExt } = require('./src/parse');
const { id, logger } = require('./src/lib/util');

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`
};

function hr(title) {
  console.log('\n' + C.b('── ' + title + ' ' + '─'.repeat(Math.max(0, 60 - title.length))));
}

function attach(tender, file) {
  const ext = detectExt(file);
  if (!ext) throw new Error('只支持 PDF / DOCX / TXT：' + file);
  const storedName = id('f') + path.extname(file).toLowerCase();
  fs.copyFileSync(file, path.join(config.uploadDir, storedName));
  const size = fs.statSync(file).size;
  store.updateTender(tender.id, {
    status: 'uploaded',
    name: tender.name === '未命名项目' ? path.basename(file, path.extname(file)) : tender.name,
    files: [{ id: id('file'), name: path.basename(file), storedName, ext, size, uploadedAt: new Date().toISOString() }]
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd !== 'run' || !argv[1]) {
    console.log('用法：node cli.js run <招标文件路径> [--json out.json]');
    process.exit(1);
  }
  const file = path.resolve(argv[1]);
  if (!fs.existsSync(file)) throw new Error('文件不存在：' + file);
  const jsonOut = argv.indexOf('--json') > 0 ? argv[argv.indexOf('--json') + 1] : null;

  store.load();
  queue.configure(1);

  const tender = store.createTender({ name: '未命名项目' });
  attach(tender, file);
  console.log(C.dim(`项目 ${tender.id} ← ${path.basename(file)}`));
  console.log(C.dim(`模型模式：${config.llm.live ? 'live / ' + config.llm.model : 'mock（规则基线）'}`));

  for (const stage of ['parse', 'blueprint', 'elements', 'generate']) {
    const job = await pipeline.runQueued(stage, tender.id);
    if (job.status !== 'done') {
      console.error(C.red(`\n阶段 ${stage} 失败：${job.error}`));
      process.exit(2);
    }
  }

  const t = store.getTender(tender.id);
  const p = t.parse;

  hr('M01/M02 文档归一化');
  console.log(`类型 ${t.doc.ext} · ${t.doc.charCount} 字 · ${t.doc.pageKnown ? t.doc.pageCount + ' 页' : '页码未知（DOCX）'} · ${t.doc.sections.length} 个章节`);
  t.doc.sections.slice(0, 8).forEach((s) => {
    console.log(C.dim(`  ${'  '.repeat(Math.max(0, s.level - 1))}${s.no} ${s.title}  ${s.page ? 'P' + s.page : ''}`));
  });

  hr('M04 项目要素');
  const pr = p.project;
  console.log(`名称 ${C.b(pr.name)}`);
  console.log(`类型 ${pr.type} · 行业 ${pr.sector} · 工期 ${pr.duration || '—'}`);
  console.log(`范围 ${pr.scope || '—'}`);
  console.log(`质量 ${pr.quality || '—'} · 地点 ${pr.location || '—'}`);
  console.log(C.dim(`confidence=${pr.confidence} evidence=${pr.evidence.section} ${pr.evidence.quote.slice(0, 40)}`));

  hr('M05 合格性条款');
  const q = p.qualifications;
  const cnt = (k) => q.filter((x) => x.resp === k).length;
  console.log(`共 ${q.length} 条：技术标内 ${cnt('tech')} · 需另附 ${cnt('attach')} · 不涉及 ${cnt('none')}`);
  q.filter((x) => x.resp === 'tech').slice(0, 6).forEach((x) => {
    console.log(`  ${C.blue('tech')} ${x.no} ${x.text.slice(0, 40)}`);
  });
  q.filter((x) => x.resp === 'attach').slice(0, 4).forEach((x) => {
    console.log(`  ${C.yellow('attach')} ${x.where} ← ${x.text.slice(0, 32)}`);
  });

  hr('M06 评分细则');
  p.scores.forEach((s) => console.log(`  ${C.b(s.id)} ${s.item}  ${C.green(s.score + ' 分')}`));
  console.log(C.dim(`合计 ${p.scoreSum} 分`));

  hr('M07 大纲模式');
  console.log(`${C.b(p.outline.mode)}（confidence=${p.outline.confidence}）${p.outline.reason}`);

  hr('M09 施工图');
  let elCount = 0;
  t.blueprint.forEach((row) => {
    elCount += row.elements.length;
    console.log(`${C.b(row.item)} ${C.dim('(' + row.score + ' 分, ' + row.elements.length + ' 条)')}`);
    row.elements.forEach((e) => console.log(`   ${e.id} ${e.name} — ${C.dim(e.mustHave)}`));
  });
  console.log(C.dim(`合计 ${elCount} 条要素`));

  hr('M13 要素表');
  t.elements.slice(0, 3).forEach((g) => {
    console.log(C.b(g.item));
    g.rows.forEach((r) => console.log(`   ${r.elementId} ${r.name}｜${r.params}`));
  });
  console.log(C.dim(`共 ${t.elements.length} 组，占位符 ${t.elementsMeta.placeholderCount} 处`));

  hr('M14 正文');
  const words = t.sections.reduce((n, s) => n + s.wordCount, 0);
  console.log(`${t.sections.length} 章 / ${words} 字`);
  if (t.sections[0]) {
    console.log(C.dim('--- 示例段落 ---'));
    console.log(t.sections[0].plain.slice(0, 260) + '…');
  }

  hr('M17/M18/M19 自检');
  t.check.items.forEach((i) => {
    const mark = i.level === 'block' ? C.red('阻断') : i.level === 'warn' ? C.yellow('提醒') : C.green('通过');
    console.log(`${mark} ${i.title}`);
    if (i.samples.length) console.log(C.dim('      ' + i.samples.join(' / ')));
  });
  console.log('\n' + C.b('门禁：') + (t.check.gate.canExport ? C.green(t.check.gate.title) : C.red(t.check.gate.title)));
  console.log(C.dim(t.check.gate.desc));

  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(t, null, 2), 'utf8');
    console.log(C.dim('\n完整结果已写入 ' + jsonOut));
  }

  store.flush();
  process.exit(0);
}

main().catch((e) => {
  logger.error(e.message);
  process.exit(1);
});
