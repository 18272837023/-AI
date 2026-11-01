'use strict';

const Ajv = require('ajv');
const config = require('../config');
const { logger, sleep, truncate } = require('./util');

/**
 * 模型调用层。三条硬约束，全部在这里落地：
 *
 * 1. 只接受结构化输出。每个单元都有 JSON Schema，过不了就重试（最多 2 次），
 *    最终仍失败则**退回规则基线**，绝不把半成品往下游传。
 * 2. 降级必须显式。返回 { degraded: true }，由流水线写进结果里，
 *    前端能看出"这段是模型抽的还是规则兜的"。
 * 3. 模型层不负责业务判断。它只把文本读懂并填进 schema，
 *    任何"要不要阻断""覆盖率够不够"都在 rules/ 里用确定性代码算。
 */

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
ajv.addFormat('iso-date', /^\d{4}(-\d{2}){0,2}$/);

const cache = new Map();

function compile(schema) {
  const key = JSON.stringify(schema);
  if (cache.has(key)) return cache.get(key);
  const validate = ajv.compile(schema);
  cache.set(key, validate);
  return validate;
}

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  // 模型常见的三种包装：```json 围栏、前后解释文字、BOM
  s = s.replace(/^\uFEFF/, '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

async function callOnce({ system, user, temperature, jsonMode, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || config.llm.timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(config.llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + config.llm.apiKey
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: temperature == null ? config.llm.temperature : temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`模型接口 ${res.status}：${truncate(body, 300)}`);
    }
    const json = await res.json();
    const choice = (json.choices || [])[0] || {};
    return {
      text: choice.message && choice.message.content ? choice.message.content : '',
      usage: json.usage || {},
      ms: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} spec
 * @param {string} spec.name      单元名，只用于日志
 * @param {string} spec.system    系统提示词
 * @param {string} spec.user      用户内容
 * @param {object} spec.schema    JSON Schema
 * @param {Function} spec.fallback 规则基线（mock 模式直接用；live 失败也用它）
 * @returns {Promise<{data:any, degraded:boolean, reason?:string, usage?:object, ms?:number}>}
 */
async function runUnit(spec) {
  const { name, system, user, schema, fallback, temperature } = spec;

  const validate = compile(schema);
  async function checkedFallback() {
    const data = await fallback();
    if(spec.prepare)spec.prepare(data);
    if (!validate(data)) throw new Error(`[${name}] 规则基线结构不合格：${ajv.errorsText(validate.errors)}`);
    const semanticError = spec.validateData && spec.validateData(data);
    if (semanticError) throw new Error(`[${name}] 规则基线内容不合格：${semanticError}`);
    return data;
  }

  if (!config.llm.live) {
    const data = await checkedFallback();
    return { data, degraded: true, reason: 'mock', ms: 0 };
  }

  let lastError = null;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0 };
  let totalMs = 0;

  for (let attempt = 0; attempt <= (spec.maxRetries ?? config.llm.maxRetries); attempt++) {
    const retryHint =
      attempt === 0
        ? ''
        : `\n\n上一次输出不符合要求，错误信息：${lastError}。请严格按 schema 输出 JSON，不要包含解释文字。`;

    let raw;
    try {
      raw = await callOnce({ system: system + '\n输出必须符合以下 JSON Schema：\n' + JSON.stringify(schema), user: user + retryHint, temperature, jsonMode: true, timeoutMs:spec.timeoutMs });
      totalMs += raw.ms || 0;
      totalUsage.prompt_tokens += (raw.usage && raw.usage.prompt_tokens) || 0;
      totalUsage.completion_tokens += (raw.usage && raw.usage.completion_tokens) || 0;
    } catch (e) {
      lastError = '调用失败：' + e.message;
      logger.warn(`[${name}] 第 ${attempt + 1} 次调用失败：${e.message}`);
      await sleep(400 * (attempt + 1));
      continue;
    }

    const parsed = extractJson(raw.text);
    if (!parsed) {
      lastError = '输出不是合法 JSON';
      logger.warn(`[${name}] 第 ${attempt + 1} 次输出非 JSON：${truncate(raw.text, 120)}`);
      continue;
    }
    if(spec.prepare){try{spec.prepare(parsed);}catch(e){lastError=e.message;logger.warn(`[${name}] 结构整理失败：${lastError}`);continue;}}
    if (!validate(parsed)) {
      lastError = ajv.errorsText(validate.errors);
      logger.warn(`[${name}] 第 ${attempt + 1} 次 schema 校验失败：${lastError}`);
      continue;
    }
    // 结构合法的前提下，先做无争议的归一化（如剔除越界的关联 ID），
    // 避免模型一处格式抖动就整章重试
    if (spec.normalize) {
      try { spec.normalize(parsed); }
      catch (e) { logger.warn(`[${name}] 归一化异常：${e.message}`); }
    }
    const semanticError = spec.validateData && spec.validateData(parsed);
    if (semanticError) { lastError = semanticError; logger.warn(`[${name}] 内容校验失败：${semanticError}`); continue; }
    return { data: parsed, degraded: false, usage: totalUsage, ms: totalMs };
  }

  logger.error(`[${name}] 模型输出连续不合格，退回规则基线：${lastError}`);
  const data = await checkedFallback();
  return { data, degraded: true, reason: 'schema_failed: ' + lastError, usage: totalUsage, ms: totalMs };
}

module.exports = {
  runUnit,
  extractJson,
  isLive: () => config.llm.live,
  modelName: () => config.llm.model,
  mode: () => (config.llm.live ? 'live' : 'mock')
};
