'use strict';

/**
 * 配置集中在这里，全部可用环境变量覆盖。
 * 刻意不引入 dotenv：一个 20 行的读取函数比多一个依赖划算。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

function num(v, dft) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
}

const config = {
  root: ROOT,
  port: num(process.env.PORT, 5310),
  host: process.env.HOST || '127.0.0.1',

  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || path.join(process.env.DATA_DIR || 'data', 'uploads')),

  /** 单文件上限（MB） */
  maxFileMB: Math.max(1,Math.min(500,num(process.env.MAX_FILE_MB, 200))),

  queue: {
    /** 同时跑几个 job。P0 是单机串行队列，够用且好排查 */
    concurrency: num(process.env.QUEUE_CONCURRENCY, 2)
  },

  llm: {
    /**
     * mock：不调用模型，走规则基线（保证链路可跑、可回归）
     * live：调用 OpenAI 兼容接口（DeepSeek / 通义 / vLLM 都兼容）
     */
    mode: (process.env.LLM_MODE || 'mock').toLowerCase(),
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    temperature: num(process.env.LLM_TEMPERATURE, 0.2),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 120000),
    /** schema 校验失败后的重试次数（不含首次） */
    maxRetries: num(process.env.LLM_MAX_RETRIES, 2)
  }
};

if (!['mock', 'live'].includes(config.llm.mode)) throw new Error('LLM_MODE 仅支持 mock 或 live');
if (config.llm.mode === 'live' && !config.llm.apiKey) throw new Error('live 模式需要配置 LLM_API_KEY');

config.llm.live = config.llm.mode === 'live' && !!config.llm.apiKey;

for (const dir of [config.dataDir, config.uploadDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
