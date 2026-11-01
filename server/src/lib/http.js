'use strict';

const http = require('node:http');

/**
 * 不引 express：P0 只需要 5 个路由和两种 body 格式，
 * 手写一个 150 行的路由比多一层框架更好排查，部署也更简单。
 */

function sendJson(res, code, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-filename',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(body);
}

function sendText(res, code, text) {
  const body = Buffer.from(String(text), 'utf8');
  res.writeHead(code, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': body.length,
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

function fail(res, code, message, extra) {
  sendJson(res, code, { ok: false, error: { message, ...(extra || {}) } });
}

function ok(res, data) {
  sendJson(res, 200, { ok: true, data });
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', (c) => {
      if (exceeded) return;
      size += c.length;
      if (limitBytes && size > limitBytes) {
        reject(Object.assign(new Error('文件超过大小限制'), { statusCode: 413 }));
        exceeded = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    req.on('aborted', () => reject(Object.assign(new Error('上传中断'), { statusCode: 400 })));
    req.on('error', reject);
  });
}

async function readJson(req, limitBytes) {
  const buf = await readBody(req, limitBytes || 2 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    const value = JSON.parse(buf.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('需要 JSON 对象');
    return value;
  } catch (e) {
    throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 });
  }
}

/**
 * 极简 multipart 解析：只处理单文件、字段名任意。
 * 小程序 wx.uploadFile 发的就是这个格式，P0 够用。
 */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + (m[1] || m[2]).trim();
  const parts = [];
  let start = buf.indexOf(boundary);
  if (start < 0) return null;

  while (start >= 0) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next < 0) break;
    const chunk = buf.slice(start + boundary.length + 2, next - 2); // 去掉 \r\n 与结尾 \r\n
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep > 0) {
      const head = chunk.slice(0, sep).toString('utf8');
      const body = chunk.slice(sep + 4);
      const nameM = /name="([^"]*)"/i.exec(head);
      const fileM = /filename="([^"]*)"/i.exec(head);
      const typeM = /content-type:\s*([^\r\n]+)/i.exec(head);
      parts.push({
        name: nameM ? nameM[1] : '',
        filename: fileM ? fileM[1] : null,
        contentType: typeM ? typeM[1].trim() : null,
        data: body
      });
    }
    start = next;
  }
  return parts;
}

/**
 * 路由表：'POST /v1/tenders/:id/parse'
 * 返回 { handler, params }
 */
function matchRoute(routes, method, pathname) {
  const segs = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const rsegs = route.path.split('/').filter(Boolean);
    if (rsegs.length !== segs.length) continue;
    const params = {};
    let hit = true;
    for (let i = 0; i < rsegs.length; i++) {
      const r = rsegs[i];
      if (r.startsWith(':')) params[r.slice(1)] = decodeURIComponent(segs[i]);
      else if (r !== segs[i]) { hit = false; break; }
    }
    if (hit) return { route, params };
  }
  return null;
}

function createRouter(routes, opts) {
  const options = opts || {};
  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      if (options.beforeRequest && !options.beforeRequest(req, res, url)) return;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type,x-filename',
          'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS'
        });
        return res.end();
      }

      const hit = matchRoute(routes, req.method, url.pathname);
      if (!hit) {
        if (options.onNotFound) return options.onNotFound(req, res, url);
        return fail(res, 404, `没有这个接口：${req.method} ${url.pathname}`);
      }

      await hit.route.handler({ req, res, params: hit.params, query: url.searchParams });
    } catch (e) {
      const badUrl = e instanceof URIError || (e instanceof TypeError && !url);
      const code = badUrl ? 400 : (e.statusCode || 500);
      if (code >= 500) console.error('[路由异常]', req.method, url && url.pathname, e);
      if (!res.headersSent) fail(res, code, e.message || '服务端错误', e.detail ? { detail: e.detail } : null);
    }
  });
}

module.exports = {
  sendJson,
  sendText,
  fail,
  ok,
  readBody,
  readJson,
  parseMultipart,
  matchRoute,
  createRouter
};
