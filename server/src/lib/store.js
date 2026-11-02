'use strict';

const path = require('node:path');
const config = require('../config');
const cloud = require('./cloud-state');
const { id, nowIso, readJsonSafe, writeJsonAtomic, logger } = require('./util');

/**
 * P0 的持久化就是"一个 JSON 文件 + 防抖落盘"。
 * 够用的理由：单机、单进程、数据量小（一份招标文件文本 ~200KB）。
 * 换成 Postgres/云数据库时，只要保持下面这组方法签名，上层不用改。
 */

const DB_FILE = path.join(config.dataDir, 'db.json');

const localState = {
  tenders: {},
  jobs: {}
};
const state = new Proxy(localState,{get(target,key){return cloud.state(target)[key];}});

let saveTimer = null;

function load() {
  if(cloud.enabled())return cloud.init();
  const raw = readJsonSafe(DB_FILE, null);
  if (raw && typeof raw === 'object') {
    Object.assign(state.tenders, raw.tenders || {});
    Object.assign(state.jobs, raw.jobs || {});
  }
  // 进程重启后，running 的 job 不可能还在跑，标记为中断，避免前端一直转圈
  for (const job of Object.values(state.jobs)) {
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'failed';
      job.error = '服务重启导致任务中断，请重新发起';
      job.finishedAt = nowIso();
    }
  }
  logger.info(`数据已载入：${Object.keys(state.tenders).length} 个标书项目 / ${Object.keys(state.jobs).length} 个任务`);
}

function save() {
  if(cloud.enabled())return cloud.save();
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      writeJsonAtomic(DB_FILE, state);
    } catch (e) {
      logger.error('落盘失败', e.message);
    }
  }, 120);
}

function flush() {
  if(cloud.enabled())return cloud.flush();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  writeJsonAtomic(DB_FILE, state);
}

// 上游变化后立即清除下游结果，避免旧正文被当作新结果。
function invalidateTender(tenderId, stage) {
  const fields = ['doc', 'parse', 'blueprint', 'elements', 'sections', 'check'];
  const start = { upload: 0, parse: 0, blueprint: 2, elements: 3, generate: 4 }[stage];
  if (start === undefined) throw new Error('未知阶段');
  const patch = {};
  for (const field of fields.slice(start)) patch[field] = null;
  if (stage === 'upload') { patch.parseCheckpoint=null; patch.supplementValues=[]; patch.supplementReplacements=[]; patch.supplementWarnings=[]; }
  if (start <= 2) patch.blueprintMeta = null;
  if (start <= 3) patch.elementsMeta = null;
  if (start <= 4) patch.generateMeta = null;
  return updateTender(tenderId, patch);
}

/* ---------------- 标书项目 ---------------- */

function createTender(input) {
  const t = {
    ...(input?.owner?{owner:input.owner}:{}),
    id: id('tnd'),
    name: (input && input.name) || '未命名项目',
    nameSource: input && input.name && input.name !== '未命名项目' ? 'manual' : 'default',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision: 0,
    status: 'created',
    files: [],
    doc: null,        // M01/M02 产出：pages + sections
    parse: null,      // M04—M07 产出：项目要素 / 合格性 / 评分 / 大纲模式
    blueprint: null,  // M09
    elements: null,   // M13
    sections: null,   // M14
    check: null       // M17—M19（纯规则，同步算）
  };
  state.tenders[t.id] = t;
  save();
  return t;
}

function getTender(tenderId) {
  return state.tenders[tenderId] || null;
}

function updateTender(tenderId, patch) {
  const t = state.tenders[tenderId];
  if (!t) return null;
  Object.assign(t, patch, { revision: (t.revision || 0) + (Object.keys(patch).some(k => k !== 'check') ? 1 : 0), updatedAt: nowIso() });
  save();
  return t;
}

function listTenders() {
  return Object.values(state.tenders).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* ---------------- 任务 ---------------- */

function createJob(tenderId, stage, total) {
  const job = {
    id: id('job'),
    tenderId,
    stage,
    status: 'queued',
    step: 0,
    total: total || 1,
    label: '排队中',
    progress: 0,
    logs: [],
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null
  };
  state.jobs[job.id] = job;
  save();
  return job;
}

function getJob(jobId) {
  return state.jobs[jobId] || null;
}

function updateJob(jobId, patch) {
  const j = state.jobs[jobId];
  if (!j) return null;
  Object.assign(j, patch);
  if (typeof patch.step === 'number' && j.total) {
    j.progress = j.status === 'done' ? 100 : Math.min(99, Math.round((patch.step / j.total) * 100));
  }
  save();
  return j;
}

function pushJobLog(jobId, level, msg) {
  const j = state.jobs[jobId];
  if (!j) return;
  j.logs.push({ t: nowIso(), level: level || 'info', msg });
  if (j.logs.length > 200) j.logs.shift();
  save();
}

/** 前端只需要看最近的任务，不需要全量 */
function listJobsByTender(tenderId) {
  return Object.values(state.jobs)
    .filter((j) => j.tenderId === tenderId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

module.exports = {
  invalidateTender,
  load,
  save,
  flush,
  createTender,
  getTender,
  updateTender,
  listTenders,
  createJob,
  getJob,
  updateJob,
  pushJobLog,
  listJobsByTender
};
