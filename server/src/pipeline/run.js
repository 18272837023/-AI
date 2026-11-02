'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');
const store = require('../lib/store');
const queue = require('../lib/queue');
const llm = require('../lib/llm');
const { parseFile, buildSections } = require('../parse');
const { SCHEMAS, PROMPTS } = require('./units');
const base = require('./baseline');
const { validateBlueprint } = require('./blueprint');
const {validateScores,validateGroup}=require('./validation');
const analysis=require('./analysis');
const { automaticNamePatch,extractName } = require('../project-name');
const checks = require('../rules/check');
const {putSection,same}=require('../repair-targets');
const { logger } = require('../lib/util');

/**
 * 流水线编排。
 *
 * 每个 stage 一个 job：接口建 job 立刻返回，队列里跑，前端轮询 GET /v1/jobs/:id。
 * 这么设计的原因很实际：小程序 wx.request 超时 60s，而一份技术标要跑几分钟。
 */

const STAGES = {
  parse: { label: '解析招标文件', total: 6 },
  blueprint: { label: '生成施工图', total: 1 },
  elements: { label: '生成要素表', total: 1 },
  generate: { label: '生成正文', total: 1 },
  repair: {label:'AI 一键优化',total:1},
  chapter: {label:'AI 编辑章节',total:1},
  rescore:{label:'重新识别评分表',total:1}
};

function step(jobId, n, label) {
  store.updateJob(jobId, { step: n, label, status: 'running' });
  store.pushJobLog(jobId, 'info', `[${n}/${store.getJob(jobId).total}] ${label}`);
  logger.info(`job ${jobId} → ${n} ${label}`);
}

function pick(list, fn) {
  return Promise.all(list.map(fn));
}

/**
 * 关联 ID 归一化：模型偶尔把章节名、中文描述写进 covers/elementId。
 * 这类格式抖动不该让整章重试——能唯一映射回合法 ID 的就修正，映射不上的交给校验拦截。
 */
function normalizeIds(value, ids) {
  const s = String(value == null ? '' : value).trim();
  if (ids.includes(s)) return s;
  const hit = /E\d+/i.exec(s);
  if (hit) {
    const cand = hit[0].toUpperCase();
    if (ids.includes(cand)) return cand;
  }
  return null;
}

function sanitizeCovers(data, ids) {
  for (const sec of (data && data.items) || []) {
    for (const b of sec.blocks || []) {
      if (!Array.isArray(b.covers)) { b.covers = []; continue; }
      const fixed = [];
      for (const c of b.covers) {
        const n = normalizeIds(c, ids);
        if (n && !fixed.includes(n)) fixed.push(n);
      }
      b.covers = fixed;
    }
  }
}

function sanitizeElementIds(data, ids) {
  for (const g of (data && data.items) || []) {
    for (const r of g.rows || []) {
      const n = normalizeIds(r.elementId, ids);
      if (n) r.elementId = n;
    }
  }
}

// 每项任务单独记录状态，页面无需根据总百分比猜测哪章正在运行。
function initItems(jobId, rows, count) {
  store.updateJob(jobId, { total:rows.length, progress:0, items:rows.map(row => ({scoreId:row.scoreId,title:row.item,status:'queued',elementCount:count(row),wordCount:null})) });
}
function updateItem(jobId, index, patch) {
  const job = store.getJob(jobId);
  const items = job.items.map((item,i) => i === index ? {...item,...patch} : item);
  const completed = items.filter(item=>item.status==='done').length;
  store.updateJob(jobId, {items,progress:Math.min(99,Math.round(completed/items.length*100))});
}

/* ---------------- parse ---------------- */

async function runParse(jobId, tender) {
  // 第一份是招标文件正文，其余是用户补传的附件（技术要求、规范、清单等）。
  // 附件必须并入章节树，否则技术要求写在附件里时评分项与要素会抽空。
  const file = tender.files[0];
  if (!file) throw Object.assign(new Error('这个项目还没有上传招标文件'), { statusCode: 400 });

  step(jobId, 1, '读取并归一化文档（M01）');
  const buf = await require('../lib/files').get(file.storedName);
  const doc = await parseFile(buf, file.name);

  step(jobId, 2, '构建章节树（M02）');
  const sections = buildSections(doc);

  const attachmentFiles = tender.files.slice(1);
  const attachments = [];
  let attachChars = 0;
  for (const att of attachmentFiles) {
    try {
      const adoc = await parseFile(await require('../lib/files').get(att.storedName), att.name);
      const asec = buildSections(adoc);
      for (const s of asec) {
        if (attachChars + (s.charCount || 0) > 800000) throw Error('附件文本总量超过处理范围，请按专业拆分工程量清单后重试');
        attachChars += s.charCount || 0;
        // 附件章节的 id 与正文重名（都从 s001 起），加前缀避免下游按 id 取错
        sections.push({
          ...s,
          id: `att${attachments.length + 1}-${s.id || sections.length + 1}`,
          no: '',
          title: `【附件：${att.name}】${s.title && s.title !== att.name ? s.title : '正文'}`,
          fromAttachment: att.name
        });
      }
      attachments.push({ id: att.id, name: att.name, used: true, sections: asec.length });
    } catch (e) {
      // 用户明确上传的清单不能悄悄丢弃，再以“附件已使用”继续生成。
      throw Object.assign(Error(`附件“${att.name}”解析失败：${e.message}`), {statusCode:422});
    }
  }

  const sourceHash = require('node:crypto').createHash('sha256').update(JSON.stringify(sections)).digest('hex');
  const checkpoint = tender.parseCheckpoint?.sourceHash === sourceHash ? {...tender.parseCheckpoint} : {sourceHash};
  async function parsedUnit(key, spec) {
    if (checkpoint[key]) return checkpoint[key];
    const result = await llm.runUnit(spec);
    checkpoint[key] = result;
    store.updateTender(tender.id, {parseCheckpoint:{...checkpoint}});
    store.flush();
    return result;
  }

  step(jobId, 3, '抽取项目要素（M04）');
  const info = await parsedUnit('project', {
    name: 'M04 项目要素',
    ...PROMPTS.projectInfo(sections,doc.pages),
    schema: SCHEMAS.projectInfo,
    normalize:data=>analysis.normalizeProject(data,sections,doc.pages),
    validateData:data=>llm.isLive()?analysis.validateProject(data,sections,doc.pages):null,
    fallback: async ({reason}={}) => {if(llm.isLive())throw Error('项目要素抽取未完成；'+(reason?'具体原因：'+String(reason).replace(/sk-[A-Za-z0-9_-]+/g,'[密钥已隐藏]').slice(0,350)+'。':'')+'请重试解析，已完成的结果会保留');return base.projectInfo(sections);}
  });
  const identified=extractName(doc);if(identified.name){info.data.name=identified.name;info.data.fieldEvidence={...info.data.fieldEvidence,name:{section:'项目名称',...identified.evidence}};}
  analysis.finishProject(info.data,sections);

  step(jobId, 4, '审查合格性条款（M05）');
  const quals = await parsedUnit('qualifications', {
    name: 'M05 合格性条款',
    ...PROMPTS.qualifications(sections),
    schema: SCHEMAS.qualifications,
    validateData:data=>llm.isLive()?analysis.validateQualifications(data,sections):null,
    fallback: async () => {if(llm.isLive())throw Error('合格性条款抽取未通过完整性校验，请重新解析');return base.qualifications(sections);}
  });

  step(jobId, 5, '抽取技术标评分细则（M06）');
  const scores = await parsedUnit('scores', {
    name: 'M06 评分细则',
    ...PROMPTS.scores(sections),
    schema: SCHEMAS.scores,
    validateData:data=>validateScores(data,sections),
    fallback: async () => base.scores(sections)
  });

  if (!scores.data.items || !scores.data.items.length) {
    throw Object.assign(
      new Error('没抽到技术标评分细则。请确认招标文件里包含"评标办法/评分标准"章节，或切到 live 模式重试。'),
      { statusCode: 422 }
    );
  }

  step(jobId, 6, '判定大纲模式（M07）');
  const outline = await parsedUnit('outline', {
    name: 'M07 大纲模式',
    ...PROMPTS.outlineMode(sections),
    schema: SCHEMAS.outlineMode,
    fallback: async () => base.outlineMode(sections)
  });

  // 交叉校验（纯规则）：分值合计异常时提示，不阻断
  const scoreSum = scores.data.items.reduce((n, s) => n + (Number(s.score) || 0), 0);
  const warnings = [];
  if (outline.data.confidence === 'low') {
    warnings.push('大纲模式置信度低，建议让用户手动三选一（strict / guided / free）');
  }
  if (scoreSum <= 0) warnings.push('技术标评分合计为 0，抽取结果可疑');

  store.updateTender(tender.id, {
    ...automaticNamePatch(tender, info.data.name),
    status: 'parsed',
    parseCheckpoint: null,
    doc: {
      ext: doc.ext,
      pageKnown: doc.pageKnown,
      pageCount: doc.pageCount || doc.pages.length,
      charCount: doc.charCount,
      warnings: doc.warnings || [],
      sections
    },
    parse: {
      sourceFile: {id:file.id,name:file.name,size:file.size},
      attachments,
      project: info.data,
      qualifications: quals.data.items,
      scores: scores.data.items,
      outline: outline.data,
      scoreSum,
      warnings,
      meta: {
        mode: llm.mode(),
        model: llm.modelName(),
        degraded: {
          project: info.degraded,
          qualifications: quals.degraded,
          scores: scores.degraded,
          outline: outline.degraded
        },
        usage: {
          prompt: (info.usage ? info.usage.prompt_tokens : 0) + (quals.usage ? quals.usage.prompt_tokens : 0) +
            (scores.usage ? scores.usage.prompt_tokens : 0) + (outline.usage ? outline.usage.prompt_tokens : 0),
          completion: (info.usage ? info.usage.completion_tokens : 0) + (quals.usage ? quals.usage.completion_tokens : 0) +
            (scores.usage ? scores.usage.completion_tokens : 0) + (outline.usage ? outline.usage.completion_tokens : 0)
        }
      }
    }
  });

  return { sections: sections.length, scores: scores.data.items.length };
}

/* ---------------- blueprint ---------------- */
async function runRescore(jobId,tender){
 if(!tender.doc?.sections?.length||!tender.parse)throw Error('请先上传并解析原件');
 step(jobId,1,'读取完整评分前附表');
 const result=await llm.runUnit({name:'评分表恢复',...PROMPTS.scores(tender.doc.sections),schema:SCHEMAS.scores,validateData:data=>validateScores(data,tender.doc.sections),fallback:async()=>{throw Error('评分表重新识别失败，原结果已保留，请重试');}});
 const snapshot=JSON.parse(JSON.stringify({parse:tender.parse,blueprint:tender.blueprint,elements:tender.elements,sections:tender.sections}));
 const parse={...tender.parse,scores:result.data.items,scoreSum:result.data.items.reduce((n,s)=>n+s.score,0),warnings:(tender.parse.warnings||[]).filter(w=>!w.includes('合计为 0'))};
 const analysisHistory=[...(tender.analysisHistory||[]),{at:new Date().toISOString(),reason:'评分识别修复',...snapshot}].slice(-3);
 store.invalidateTender(tender.id,'blueprint');
 store.updateTender(tender.id,{parse,analysisHistory,status:'parsed'});store.flush();
 return {scores:parse.scores.length,scoreSum:parse.scoreSum};
}

async function runBlueprint(jobId, tender) {
  if (!tender.parse) throw Object.assign(new Error('还没解析招标文件'), { statusCode: 400 });
  const scores = tender.parse.scores;

  step(jobId, 1, '把评分项拆成必答要素（M09）');
  const res = await llm.runUnit({
    name: 'M09 施工图',
    ...PROMPTS.blueprint(scores),
    schema: SCHEMAS.blueprint,
    validateData: data => validateBlueprint(data, scores),
    fallback: async () => base.blueprint({ items: scores })
  });

  // 规则收敛：要素数 <4 或 >7 时裁剪/合并，不交给模型自觉
  const items = res.data.items.map((row) => {
    let els = row.elements || [];
    if (els.length > 7) els = els.slice(0, 7);
    els = els.map((e, i) => ({ ...e, id: e.id || 'E' + (i + 1) }));
    const original=scores.find(s=>s.id===row.scoreId);
    return { ...row,item:original.item,score:original.score,tierDesc:original.tierDesc,elements: els };
  });

  const thin = items.filter((r) => r.elements.length < 4).map((r) => r.item);

  store.updateTender(tender.id, {
    status: 'blueprint',
    blueprint: items,
    blueprintMeta: {
      degraded: res.degraded,
      elementCount: items.reduce((n, r) => n + r.elements.length, 0),
      thin: thin,
      at: new Date().toISOString()
    }
  });

  return { items: items.length, elements: items.reduce((n, r) => n + r.elements.length, 0), thin };
}

/* ---------------- elements ---------------- */

async function runElements(jobId, tender) {
  const bp = tender.blueprint;
  if (!bp || !bp.length) throw Object.assign(new Error('还没生成施工图'), { statusCode: 400 });

  const target=store.getJob(jobId).options?.scoreId,selected=target?bp.filter(row=>same(row.scoreId,target)):bp;
  if(!selected.length)throw Error('重试章节已不存在，请刷新后重试');
  initItems(jobId, selected, row => row.elements.length);
  const retry=!!store.getJob(jobId).options?.retryFailed||!!target;
  const out = retry?JSON.parse(JSON.stringify(tender.elements||[])):[];
  const failed = target?(tender.elementsMeta?.failed||[]).filter(r=>!same(r.scoreId,target)):[];
  let i = 0;
  for (const row of selected) {
    i += 1;
    step(jobId, i, `填要素表：${row.item}`);
    updateItem(jobId, i-1, {status:'running'});
    const completed=out.find(g=>same(g.scoreId,row.scoreId));
    if(retry&&completed&&row.elements.every(e=>completed.rows?.some(r=>r.elementId===e.id))){updateItem(jobId,i-1,{status:'done'});continue;}
    try {
      const res = await llm.runUnit({
        name: 'M13 要素表',
        ...PROMPTS.elementTable(row, { project: tender.parse.project, qualifications: tender.parse.qualifications,confirmedRows:retry?completed?.rows||[]:[],billOfQuantities:require('./attachment-context').attachmentContext(tender.doc?.sections||[],row.item),source:require('./units').docBlock(require('./units').pickSections(tender.doc?.sections||[],[row.item,'技术要求','招标范围','建设规模'],{max:10}),18000) }),
        schema: require('./units').forScore(SCHEMAS.elementTable,row.scoreId),
        normalize: (data) => sanitizeElementIds(data, row.elements.map((e) => e.id)),
        validateData:data=>validateGroup(data,row,'rows'),
        fallback: async ({reason}={}) => {if(llm.isLive())throw Error('本章要素表未生成完整：'+(reason||'模型暂时不可用')+'；请重试本章');return { items: [base.elementTable(row)] };}
      });
      for(const group of res.data.items||[])putSection(out,{...group,rows:group.rows.map(r=>retry&&completed?.rows?.find(old=>old.elementId===r.elementId)||r)},bp);
      updateItem(jobId, i-1, {status:'done'});
    } catch (e) {
      // 单章失败不拖垮整阶段：记录后继续，其余章节照常产出
      failed.push({ scoreId: row.scoreId, item: row.item, error: e.message });
      updateItem(jobId, i-1, {status:'failed', error: e.message});
      store.pushJobLog(jobId, 'error', `「${row.item}」失败：${e.message}`);
    }
  }

  if (!out.length) {
    store.updateTender(tender.id,{elementsMeta:{...tender.elementsMeta,failed,at:new Date().toISOString()}});
    throw Object.assign(
      new Error(`全部 ${bp.length} 个评分项的要素表都没生成成功。${failed[0] ? '首个错误：' + failed[0].error : ''}`),
      { statusCode: 422 }
    );
  }

  const placeholderCount = out.reduce(
    (n, g) => n + (g.rows || []).filter((r) => /〔待确认[:：]/.test(r.params || '')).length, 0
  );

  store.updateTender(tender.id, {
    status: 'elements',
    elements: out,
    elementsMeta: {
      groups: out.length,
      placeholderCount,
      failed: failed.length ? failed : undefined,
      at: new Date().toISOString()
    }
  });

  return { groups: out.length, placeholderCount, failed: failed.length };
}

/* ---------------- generate ---------------- */

async function runGenerate(jobId, tender) {
  const els = tender.elements;
  if (!els || !els.length) throw Object.assign(new Error('还没生成要素表'), { statusCode: 400 });

  const target=store.getJob(jobId).options?.scoreId,selected=target?els.filter(group=>same(group.scoreId,target)):els;
  if(!selected.length)throw Error('重试章节要素表不存在，请先重试本章要素表');
  initItems(jobId, selected, group => group.rows.length);
  const retry=!!store.getJob(jobId).options?.retryFailed||!!target;
  const out = retry?JSON.parse(JSON.stringify(tender.sections||[])):[];
  const generatedIds=new Set();
  const failed = target?(tender.generateMeta?.failed||[]).filter(r=>!same(r.scoreId,target)):[];
  let i = 0;
  for (const group of selected) {
    i += 1;
    step(jobId, i, `展开正文：${group.item}`);
    updateItem(jobId, i-1, {status:'running'});
    const completed=out.find(s=>same(s.scoreId,group.scoreId));
    if(retry&&completed?.blocks?.some(b=>b.type!=='h4'&&b.text?.trim())){updateItem(jobId,i-1,{status:'done',wordCount:completed.wordCount||0});continue;}
    try {
      const res = await require('./chapter-content').generate(group, { project: tender.parse.project, qualifications: tender.parse.qualifications, outline: tender.parse.outline,totalElements:(tender.blueprint||[]).reduce((n,bp)=>n+bp.elements.length,0)||els.reduce((n,g)=>n+g.rows.length,0),billOfQuantities:require('./attachment-context').attachmentContext(tender.doc?.sections||[],group.item),source:require('./units').docBlock(require('./units').pickSections(tender.doc?.sections||[],[group.item,'技术要求','招标范围','建设规模'],{max:10}),18000) },{
        normalize: (data) => sanitizeCovers(data, group.rows.map((r) => r.elementId)),
        onPart:part=>updateItem(jobId,i-1,{part:part.index,parts:part.total,phaseLabel:`正在展开正文（本章第 ${part.index}/${part.total} 部分）`})
      });
      for (const sec of res.data.items || []) {
        const plain = (sec.blocks || []).map((b) => b.type==='table'?[b.text,...(b.rows||[]).map(r=>r.join(' | '))].join('\n'):b.text).join('\n');
        putSection(out,{
          ...sec,
          plain,
          wordCount: plain.replace(/\s/g, '').length,
          degraded: res.degraded
        },tender.blueprint);
        generatedIds.add(String(sec.scoreId));
      }
      updateItem(jobId, i-1, {status:'done',wordCount:out.filter(s=>same(s.scoreId,group.scoreId)).reduce((n,s)=>n+s.wordCount,0)});
    } catch (e) {
      // 单章失败不拖垮整阶段：其余章节照常产出，失败章节在任务里标出便于重试
      failed.push({ scoreId: group.scoreId, item: group.item, error: e.message });
      updateItem(jobId, i-1, {status:'failed', error: e.message});
      store.pushJobLog(jobId, 'error', `「${group.item}」失败：${e.message}`);
    }
  }

  if (!out.length) {
    store.updateTender(tender.id,{generateMeta:{...tender.generateMeta,failed,at:new Date().toISOString()}});
    throw Object.assign(
      new Error(`全部 ${els.length} 个章节都没生成成功。${failed[0] ? '首个错误：' + failed[0].error : ''}`),
      { statusCode: 422 }
    );
  }

  const applied=require('../supplements').applyToSections({...tender,sections:out.filter(s=>generatedIds.has(String(s.scoreId)))},undefined,true);
  const finalSections=out.map(s=>applied.sections.find(next=>same(next.scoreId,s.scoreId))||s);
  const check = checks.checkAll({ ...tender, sections: finalSections, supplementWarnings:applied.warnings });
  store.updateJob(jobId,{items:store.getJob(jobId).items.map(item=>({...item,wordCount:finalSections.filter(s=>s.scoreId===item.scoreId).reduce((n,s)=>n+s.wordCount,0)}))});

  store.updateTender(tender.id, {
    status: 'generated',
    sections: finalSections,
    supplementReplacements:[...(retry?(tender.supplementReplacements||[]).filter(r=>!generatedIds.has(String(r.scoreId))):[]),...applied.replacements],
    supplementWarnings:[...new Set([...(retry?tender.supplementWarnings||[]:[]),...applied.warnings])],
    check,
    generateMeta: {
      sections: finalSections.length,
      failed: failed.length ? failed : undefined,
      at: new Date().toISOString()
    }
  });

  return {
    sections: finalSections.length,
    words: finalSections.reduce((n, s) => n + s.wordCount, 0),
    blocking: check.blocking,
    failed: failed.length
  };
}

/* ---------------- 入口 ---------------- */

async function run(jobId, stage, inCloudContext=false) {
  const cloud=require('../lib/cloud-state');
  if(cloud.enabled()&&!inCloudContext){
    try{return await cloud.run(true,()=>run(jobId,stage,true),{wait:1});}
    catch(e){if(e.statusCode===409){setTimeout(()=>run(jobId,stage).catch(error=>logger.error('任务恢复失败',error.message)),1500);return;}throw e;}
  }
  const job = store.getJob(jobId);
  if (!job) return;
  if(cloud.enabled()&&['done','failed'].includes(job.status))return;
  const tender = store.getTender(job.tenderId);
  if (!tender) {
    store.updateJob(jobId, { status: 'failed', error: '项目不存在', finishedAt: new Date().toISOString() });
    return;
  }

  store.updateJob(jobId, { status: 'running', startedAt: new Date().toISOString() });
  try {
    let result;
    if (stage === 'parse') result = await runParse(jobId, tender);
    else if(stage==='rescore')result=await runRescore(jobId,tender);
    else if (stage === 'blueprint') result = await runBlueprint(jobId, tender);
    else if (stage === 'elements') result = await runElements(jobId, tender);
    else if (stage === 'generate') result = await runGenerate(jobId, tender);
    else if (stage === 'repair' || stage==='chapter') result = await require('../writing').run(jobId,tender,stage);
    else throw new Error('未知阶段：' + stage);

    store.updateJob(jobId, {
      status: 'done',
      step: store.getJob(jobId).total,
      progress: 100,
      label: result?.failed>0?'部分完成，有内容需重试':'完成',
      result: result || null,
      finishedAt: new Date().toISOString()
    });
    await store.flush();
  } catch (e) {
    logger.error(`job ${jobId} 失败：${e.message}`);
    store.pushJobLog(jobId, 'error', e.message);
    const items = store.getJob(jobId).items;
    if (items) store.updateJob(jobId,{items:items.map(item=>item.status==='running'?{...item,status:'failed'}:item)});
    store.updateJob(jobId, {
      status: 'failed',
      error: e.message,
      finishedAt: new Date().toISOString()
    });
  }
}

/** 同步自检：纯规则，毫秒级，不需要建 job */
function checkNow(tender) {
  const result = checks.checkAll(tender);
  store.updateTender(tender.id, { check: result });
  return result;
}

/**
 * 建 job 并入队，返回一个"跑完才 resolve"的 Promise。
 * 只给 CLI / 测试用：HTTP 侧永远是建 job 立刻返回，让前端轮询。
 */
function runQueued(stage, tenderId) {
  const def = STAGES[stage];
  if (!def) return Promise.reject(new Error('未知阶段：' + stage));
  const job = store.createJob(tenderId, stage, def.total);
  return new Promise((resolve) => {
    queue.enqueue({
      run: async () => {
        await run(job.id, stage);
        resolve(store.getJob(job.id));
      }
    });
  });
}

module.exports = { STAGES, run, checkNow, runQueued };
