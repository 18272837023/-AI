'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const store = require('./lib/store');
const queue = require('./lib/queue');
const { ok, fail, readJson, readBody, parseMultipart } = require('./lib/http');
const { id, ensureDir, logger } = require('./lib/util');
const { extractName, automaticNamePatch, cleanName } = require('./project-name');
const { detectExt, parseFile } = require('./parse');
const pipeline = require('./pipeline/run');
const llm = require('./lib/llm');

/** 同一个项目同一阶段只允许有一个在跑的任务，避免用户连点两次烧两次 token */
function findRunningJob(tenderId, stage) {
  return store.listJobsByTender(tenderId).find(
    (j) => j.stage === stage && (j.status === 'queued' || j.status === 'running')
  );
}

function assertIdle(tenderId) {
  const active = store.listJobsByTender(tenderId).find(j => j.status === 'queued' || j.status === 'running');
  if (active) throw Object.assign(new Error('项目有任务正在执行，请等待完成'), { statusCode: 409 });
}

function startJob(tender, stage, options) {
  const running = findRunningJob(tender.id, stage);
  if(running&&stage==='expand'&&running.options?.targetPages!==options?.targetPages)throw Object.assign(Error('正在按先前的目标页数扩写，请等待完成后再修改目标'),{statusCode:409});
  if (running) {if((running.options?.scoreId||null)!==(options?.scoreId||null))throw Object.assign(Error('项目有其他生成任务正在执行，请等待完成后重试本章'),{statusCode:409});return { job: running, reused: true };}

  assertIdle(tender.id);
  const def = pipeline.STAGES[stage];
  if (!def) throw Object.assign(new Error('未知阶段：' + stage), { statusCode: 400 });
  const retryPartial=options?.retryFailed===true&&['elements','generate'].includes(stage);
  if(!['repair','chapter','rescore','expand'].includes(stage)&&!retryPartial)store.invalidateTender(tender.id, stage);
  const job = store.createJob(tender.id, stage, def.total);
  if(options)store.updateJob(job.id,{options});
  queue.enqueue({ run: () => pipeline.run(job.id, stage) });
  return { job, reused: false };
}

function requireTender(params) {
  const t = store.getTender(params.id);
  const cloud=require('./lib/cloud-state');
  if (!t || cloud.enabled() && t.owner!==cloud.owner()) throw Object.assign(new Error('项目不存在：' + params.id), { statusCode: 404 });
  return t;
}

function brief(t) {
  const expected=t.blueprint||[];
  const completed=expected.filter(bp=>(t.sections||[]).some(s=>sameScore(s.scoreId,bp.scoreId)&&s.blocks?.some(b=>b.type!=='h4'&&b.text?.trim()))).length;
  return {
    id: t.id,
    revision: t.revision || 0,
    name: t.name,
    nameSource: t.nameSource || null,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    file: t.files.length ? { name: t.files[0].name, size: t.files[0].size } : null,
    attachments: Math.max(0, t.files.length - 1),
    generation:{completed,total:expected.length,complete:expected.length>0&&completed===expected.length},
    stages: {
      parsed: !!t.parse,
      blueprint: !!t.blueprint,
      elements: expected.length>0&&expected.every(bp=>(t.elements||[]).some(g=>sameScore(g.scoreId,bp.scoreId)&&bp.elements.every(e=>g.rows?.some(r=>r.elementId===e.id)))),
      sections: expected.length>0&&completed===expected.length,
      checked: !!t.check
    }
  };
}

async function persistUpload(t, filename, data) {
const ext = detectExt(filename);
      if (!ext) {
        throw Object.assign(new Error('支持 PDF / DOCX / TXT；工程量清单附件支持 XLSX / XLS'), { statusCode: 415 });
      }
      if (!t.files.length && ['xlsx','xls'].includes(ext)) throw Object.assign(Error('请先上传 PDF / DOCX / TXT 招标文件正文，再通过“上传附件”添加 Excel 工程量清单'), {statusCode:400});

      assertIdle(t.id); // 读取上传请求期间可能启动了任务
      ensureDir(config.uploadDir);
      const storedName = id('f') + path.extname(filename).toLowerCase();
      await require('./lib/files').put(storedName, data);

      const file = {
        id: id('file'),
        name: filename,
        storedName,
        ext,
        size: data.length,
        uploadedAt: new Date().toISOString()
      };

      const files = t.files.concat(file);
      const patch = { files, status: 'uploaded' };
      // 只有第一份文件（招标文件正文）才用于命名；后补的附件不能把项目名改掉。
      if (!t.files.length && t.nameSource !== 'manual' && (t.nameSource || t.name === '未命名项目')) {
        patch.name = filename.replace(/\.[^.]+$/, '');
        patch.nameSource = 'file';
      }
      store.invalidateTender(t.id, 'upload');
      store.updateTender(t.id, patch);

      logger.info(`上传 ${filename}（${(data.length / 1024).toFixed(0)}KB）→ ${storedName}`);
      return { file: { id: file.id, name: file.name, size: file.size, ext: file.ext } };
}

const routes = [
  {method:'GET',path:'/v1/tenders/:id/expansion-plan',async handler({res,params,query}){ok(res,require('./expansion').plan(requireTender(params),Number(query.get('targetPages'))));}},
  {method:'POST',path:'/v1/tenders/:id/expand',async handler({req,res,params}){const body=await readJson(req),t=requireTender(params);const plan=require('./expansion').plan(t,body.targetPages);if(plan.addWords<100)throw Object.assign(Error('现有篇幅已达到目标，请提高目标总页数'),{statusCode:400});const {job,reused}=startJob(t,'expand',{targetPages:body.targetPages});ok(res,{jobId:job.id,reused});}},
  {method:'POST',path:'/v1/tenders/:id/chapters',async handler({req,res,params}){const t=requireTender(params);assertIdle(t.id);ok(res,require('./chapters').change(t,await readJson(req)));}},
  {method:'PUT',path:'/v1/tenders/:id/pending-facts',async handler({req,res,params}){const t=requireTender(params);assertIdle(t.id);ok(res,require('./pending-facts').save(t,await readJson(req)));}},
  ...require('./cloud-transfers').routes(requireTender,assertIdle,persistUpload),
  {method:'POST',path:'/v1/tenders/:id/rescore',async handler({res,params}){const t=requireTender(params);if(!t.doc?.sections?.length||!t.parse)throw Object.assign(Error('请先完成原件解析'),{statusCode:400});const{job,reused}=startJob(t,'rescore');ok(res,{jobId:job.id,reused});}},
  {method:'POST',path:'/v1/tenders/:id/repair',async handler({req,res,params}){
    const body=await readJson(req),t=requireTender(params);
    if(!t.sections?.length&&!t.blueprint?.length)throw Object.assign(Error('请先确认解析结果和施工图，再生成或补写正文'),{statusCode:400});
    const c=require('./rules/check').checkAll(t);
    if(!c.items.some(i=>i.level!=='pass'&&i.fixType==='auto'&&(!body.issueId||i.id===body.issueId)))throw Object.assign(Error('没有可由 AI 修复的问题'),{statusCode:400});
    const {job,reused}=startJob(t,'repair',{issueId:body.issueId||null});ok(res,{jobId:job.id,reused});
  }},
  {method:'POST',path:'/v1/tenders/:id/chapter-ai',async handler({req,res,params}){
    const body=await readJson(req),t=requireTender(params);
    if(!['continue','expand','polish','chart'].includes(body.action)||!t.sections?.some(s=>s.scoreId===body.scoreId))throw Object.assign(Error('请选择有效章节与操作'),{statusCode:400});
    const {job,reused}=startJob(t,'chapter',{action:body.action,scoreId:body.scoreId});ok(res,{jobId:job.id,reused});
  }},
  {
    method:'GET',path:'/v1/tenders/:id/supplements',
    async handler({res,params}) {
      const t=requireTender(params),s=require('./supplements'),groups=s.getGroups(t);
      ok(res,{revision:t.revision||0,groups,stats:s.stats(groups),warnings:t.supplementWarnings||[],hasSections:!!t.sections?.length});
    }
  },
  {
    method:'PUT',path:'/v1/tenders/:id/supplements',
    async handler({req,res,params}) {
      const body=await readJson(req),t=requireTender(params);assertIdle(t.id);
      ok(res,require('./supplements').save(t,body));
    }
  },
  {
    method:'POST',path:'/v1/tenders/:id/supplements/training-draft',
    async handler({res,params}) {const t=requireTender(params);assertIdle(t.id);ok(res,await require('./supplements').trainingDraft(t));}
  },

  {
    method: 'POST', path: '/v1/tenders/:id/identify-name',
    async handler({ req, res, params }) {
      const body = await readJson(req);
      const t = requireTender(params); assertIdle(t.id);
      const file = t.files[0];
      if (!file) throw Object.assign(new Error('请先上传文件'), {statusCode:400});
      const doc = await parseFile(await require('./lib/files').get(file.storedName),file.name);
      const result = extractName(doc);
      assertIdle(t.id);
      if (t.files[0].id !== file.id) throw Object.assign(new Error('文件已变化，请重新识别'), {statusCode:409});
      // 默认保护人工名称（上传后自动识别不应该覆盖用户填写的名称）；
      // force=true 用于用户显式点「重新识别项目名」，识别结果直接生效。
      const patch = body.force === true
        ? (cleanName(result.name) ? { name: cleanName(result.name), nameSource: 'document' } : {})
        : automaticNamePatch(t, result.name);
      if (patch.name) { store.updateTender(t.id,patch); store.flush(); }
      ok(res, { ...result, applied:Boolean(patch.name), tender:brief(t) });
    }
  },
  {
    method:'PUT', path:'/v1/tenders/:id/name',
    async handler({req,res,params}) {
      const body = await readJson(req), t = requireTender(params); assertIdle(t.id);
      if (body.revision !== (t.revision || 0)) throw Object.assign(new Error('项目已变化，请刷新后重试'),{statusCode:409});
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) throw Object.assign(new Error('项目名称应为 1—200 字'),{statusCode:400});
      store.updateTender(t.id,{name:body.name.trim(),nameSource:'manual'}); store.flush(); ok(res,brief(t));
    }
  },

  {
    method: 'GET', path: '/',
    async handler({ req, res }) {
      require('../../tools/preview/server').handle(req, res);
    }
  },
  ...['parse', 'blueprint', 'elements', 'sections'].map(field => ({
    method: 'PUT', path: '/v1/tenders/:id/' + field,
    async handler({ req, res, params }) {
      const body = await readJson(req, 10 * 1024 * 1024);
      const t = requireTender(params);
      assertIdle(t.id);
      ok(res, require('./edit').edit(t, field, body));
    }
  })),
  {
    method: 'GET', path: '/v1/tenders/:id/export',
    async handler({ res, params, query }) {
      const t = requireTender(params);
      assertIdle(t.id);
      if (!t.sections || !t.sections.length) throw Object.assign(new Error('请先生成正文'), { statusCode: 400 });
      const check = pipeline.checkNow(t);
      const draft = query.get('draft') === '1';
      if (!draft && !check.gate.canExport) return fail(res, 409, '请处理自检阻断项，或选择测试草稿导出', { check });
      const snapshot = JSON.parse(JSON.stringify(t));
      const opts=require('./export-options').exportOptions(query);
      const format=query.get('format')||'word';if(!['word','pdf'].includes(format))throw Object.assign(Error('导出格式无效'),{statusCode:400});
      const data = format==='pdf'?await require('./export-pdf').buildPdf(snapshot,draft,opts):await require('./export').buildDocx(snapshot, draft,opts);
      if(query.get('cloud')==='1')return ok(res,await require('./cloud-transfers').exportFile(t,data,format==='pdf'?'pdf':'docx'));
      res.writeHead(200, {
        'content-type': format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${draft ? 'draft' : 'technical-bid'}.${format==='pdf'?'pdf':'docx'}"`,
        'content-length': data.length, 'cache-control': 'no-store'
      });
      res.end(data);
    }
  },
  {
    method: 'GET',
    path: '/v1/health',
    async handler({ res }) {
      ok(res, {
        up: true,
        maxFileMB:config.maxFileMB,
        llm: { mode: llm.mode(), model: llm.modelName(), live: llm.isLive() },
        queue: queue.size(),
        time: new Date().toISOString()
      });
    }
  },

  /* ---------------- 项目 ---------------- */

  {
    method: 'POST',
    path: '/v1/tenders',
    async handler({ req, res }) {
      const body = await readJson(req);
      if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 200)) {
        throw Object.assign(new Error('项目名称应为不超过 200 字的文本'), { statusCode: 400 });
      }
      const t = store.createTender({ name: body.name && body.name.trim() || '未命名项目',owner:require('./lib/cloud-state').owner() });
      logger.info(`新建项目 ${t.id}`);
      ok(res, brief(t));
    }
  },

  {
    method: 'GET',
    path: '/v1/tenders',
    async handler({ res }) {
      const cloud=require('./lib/cloud-state');
      ok(res, store.listTenders().filter(t=>!cloud.enabled()||t.owner===cloud.owner()).map(brief));
    }
  },

  {
    method: 'GET',
    path: '/v1/tenders/:id',
    async handler({ res, params, query }) {
      const t = requireTender(params);
      if (query.get('slim') === '1') return ok(res, brief(t));
      ok(res, {
        ...brief(t),
        doc: t.doc
          ? {
              ext: t.doc.ext,
              pageKnown: t.doc.pageKnown,
              pageCount: t.doc.pageCount,
              charCount: t.doc.charCount,
              warnings: t.doc.warnings,
              sectionCount: (t.doc.sections || []).length,
              sections: (t.doc.sections || []).slice(0, 40).map((s) => ({
                id: s.id, level: s.level, no: s.no, title: s.title, page: s.page, charCount: s.charCount
              }))
            }
          : null,
        parse: t.parse,
        blueprint: t.blueprint,
        blueprintMeta: t.blueprintMeta,
        elements: t.elements,
        elementsMeta: t.elementsMeta,
        pendingFacts: require('./pending-facts').list(t),
        sections: t.sections,
        supplements: {stats:require('./supplements').stats(require('./supplements').getGroups(t)),warnings:t.supplementWarnings||[]},
        check: t.check
      });
    }
  },

  /* ---------------- 上传 ---------------- */

  {
    method: 'POST',
    path: '/v1/tenders/:id/files',
    async handler({ req, res, params }) {
      const t = requireTender(params);
      assertIdle(t.id);
      const limit = config.maxFileMB * 1024 * 1024;
      const ct = req.headers['content-type'] || '';
      const buf = await readBody(req, limit+64*1024);

      let filename = '';
      let data = buf;

      if (/multipart\/form-data/i.test(ct)) {
        const parts = parseMultipart(buf, ct);
        if (!parts || !parts.length) throw Object.assign(new Error('multipart 解析失败'), { statusCode: 400 });
        const filePart = parts.find((p) => p.filename);
        if (!filePart) throw Object.assign(new Error('缺少上传文件'), { statusCode: 400 });
        filename = filePart.filename || 'unnamed';
        data = filePart.data;
      } else {
        filename = req.headers['x-filename'] || '';
        try {
          filename = decodeURIComponent(filename);
        } catch (e) { /* 原样使用 */ }
      }

      if (!filename) throw Object.assign(new Error('缺少文件名（header x-filename 或 multipart filename）'), { statusCode: 400 });
      if (!data || !data.length) throw Object.assign(new Error('文件内容为空'), { statusCode: 400 });
      if (data.length>limit) throw Object.assign(new Error(`文件不能超过 ${config.maxFileMB}MB`),{statusCode:413});

      ok(res, await persistUpload(t, filename, data));
    }
  },

  /* ---------------- 流水线阶段 ---------------- */

  {
    method: 'POST',
    path: '/v1/tenders/:id/parse',
    async handler({ res, params }) {
      const t = requireTender(params);
      if (!t.files.length) throw Object.assign(new Error('请先上传招标文件'), { statusCode: 400 });
      const { job, reused } = startJob(t, 'parse');
      ok(res, { jobId: job.id, stage: job.stage, reused });
    }
  },

  {
    method: 'POST',
    path: '/v1/tenders/:id/blueprint',
    async handler({ res, params }) {
      const t = requireTender(params);
      if (!t.parse) throw Object.assign(new Error('请先完成解析'), { statusCode: 400 });
      const { job, reused } = startJob(t, 'blueprint');
      ok(res, { jobId: job.id, stage: job.stage, reused });
    }
  },

  {
    method: 'POST',
    path: '/v1/tenders/:id/elements',
    async handler({ req, res, params }) {
      const body=await readJson(req);
      const t = requireTender(params);
      if (!t.blueprint) throw Object.assign(new Error('请先生成施工图'), { statusCode: 400 });
      if(body.scoreId!==undefined&&(typeof body.scoreId!=='string'||!t.blueprint.some(bp=>sameScore(bp.scoreId,body.scoreId))))throw Object.assign(Error('请选择有效的重试章节'),{statusCode:400});
      const { job, reused } = startJob(t, 'elements',{retryFailed:body.retryFailed===true||body.scoreId!==undefined,...(body.scoreId!==undefined?{scoreId:body.scoreId}:{})});
      ok(res, { jobId: job.id, stage: job.stage, reused });
    }
  },

  {
    method: 'POST',
    path: '/v1/tenders/:id/generate',
    async handler({ req, res, params }) {
      const body=await readJson(req);
      const t = requireTender(params);
      if (!t.elements) throw Object.assign(new Error('请先生成要素表'), { statusCode: 400 });
      if(body.scoreId!==undefined&&(typeof body.scoreId!=='string'||!t.blueprint?.some(bp=>sameScore(bp.scoreId,body.scoreId))))throw Object.assign(Error('请选择有效的重试章节'),{statusCode:400});
      if(t.blueprint?.filter(bp=>body.scoreId===undefined||sameScore(bp.scoreId,body.scoreId)).some(bp=>!t.elements.some(g=>sameScore(g.scoreId,bp.scoreId)&&bp.elements.every(e=>g.rows?.some(r=>r.elementId===e.id)))))throw Object.assign(Error('还有评分项的要素表未完成，请先重试要素表生成'),{statusCode:400});
      const { job, reused } = startJob(t, 'generate',{retryFailed:body.retryFailed===true||body.scoreId!==undefined,...(body.scoreId!==undefined?{scoreId:body.scoreId}:{})});
      ok(res, { jobId: job.id, stage: job.stage, reused });
    }
  },

  {
    method: 'POST',
    path: '/v1/tenders/:id/check',
    async handler({ res, params }) {
      const t = requireTender(params);
      if (!t.sections) throw Object.assign(new Error('还没有正文可检查'), { statusCode: 400 });
      ok(res, pipeline.checkNow(t));
    }
  },

  /* ---------------- 任务 ---------------- */

  {
    method: 'GET',
    path: '/v1/jobs/:jobId',
    async handler({ res, params }) {
      const j = store.getJob(params.jobId);
      if (!j) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });
      requireTender({id:j.tenderId});
      ok(res, j);
    }
  },

  {
    method: 'GET',
    path: '/v1/tenders/:id/jobs',
    async handler({ res, params }) {
      const t = requireTender(params);
      ok(res, store.listJobsByTender(t.id).slice(0, 20));
    }
  }
];

for(const route of routes){const handler=route.handler;route.handler=args=>require('./cloud-request').handle(route,args,handler);}
module.exports = { routes };
function sameScore(a,b){return String(a)===String(b);}
