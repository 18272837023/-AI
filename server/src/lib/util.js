'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** 短 id：前缀 + 时间戳36进制 + 4位随机，便于日志里肉眼区分 */
function id(prefix) {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(3).toString('hex').slice(0, 4);
  return `${prefix}_${t}${r}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(str, n) {
  if (typeof str !== 'string') return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/** 把任意文本切成"行"，去掉首尾空白与空行，但保留序号 */
function toLines(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\u00a0\u3000]/g, ' ').trim())
    .filter((l) => l.length > 0);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/** 原子写：先写 .tmp 再 rename，避免进程被杀时留下半个 JSON */
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readJsonSafe(file, dft) {
  if (!fs.existsSync(file)) return dft;
  const raw = fs.readFileSync(file, 'utf8');
  const val = safeJson(raw);
  return val == null ? dft : val;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT = LEVELS[process.env.LOG_LEVEL || 'info'] || 20;

function log(level, msg, extra) {
  if (LEVELS[level] < CURRENT) return;
  const t = new Date().toISOString().slice(11, 23);
  const tail = extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
  console.log(`[${t}] ${level.toUpperCase().padEnd(5)} ${msg}${tail}`);
}

const logger = {
  debug: (m, e) => log('debug', m, e),
  info: (m, e) => log('info', m, e),
  warn: (m, e) => log('warn', m, e),
  error: (m, e) => log('error', m, e)
};

module.exports = {
  id,
  nowIso,
  sleep,
  truncate,
  toLines,
  safeJson,
  writeJsonAtomic,
  readJsonSafe,
  ensureDir,
  logger,
  join: path.join
};
