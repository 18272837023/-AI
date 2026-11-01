/**
 * 小程序预览器 · 本地服务
 * 读取 ../miniprogram 下的真实源码，提供给浏览器端运行时
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../miniprogram');
const HERE = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readSafe(base, rel) {
  const p = path.resolve(base, rel);
  if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function readIcon(rel) {
  if (path.extname(rel).toLowerCase() === '.svg') return readSafe(ROOT, rel);
  const file = path.resolve(ROOT, rel);
  const type = MIME[path.extname(file).toLowerCase()];
  if (!file.startsWith(ROOT + path.sep) || !type || !type.startsWith('image/')) return null;
  try { return 'data:' + type + ';base64,' + fs.readFileSync(file).toString('base64'); } catch (_) { return null; }
}

function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p.startsWith('/v1/')) {
    const upstream = http.request({ hostname: '127.0.0.1', port: 5310, path: req.url, method: req.method, headers: req.headers }, r => {res.writeHead(r.statusCode, r.headers); r.pipe(res);});
    upstream.on('error', () => send(res, 502, MIME['.json'], JSON.stringify({ok:false,error:{message:'请启动标书服务'}})));
    req.pipe(upstream); return;
  }

  // 应用配置
  if (p === '/api/app') {
    const t = readSafe(ROOT, 'app.json');
    if (!t) return send(res, 404, MIME['.json'], '{}');
    try {
      const json = JSON.parse(t);
      if (json.tabBar && json.tabBar.list) {
        json.tabBar.list.forEach(function (item) {
          if (item.iconPath) {
            const svg = readIcon(item.iconPath);
            if (svg) item.iconPath = svg;
          }
          if (item.selectedIconPath) {
            const svg = readIcon(item.selectedIconPath);
            if (svg) item.selectedIconPath = svg;
          }
        });
      }
      return send(res, 200, MIME['.json'], JSON.stringify(json));
    } catch (e) {
      return send(res, 200, MIME['.json'], t);
    }
  }

  // app.js（用于获取 globalData）
  if (p === '/api/appjs') {
    const t = readSafe(ROOT, 'app.js');
    return send(res, 200, 'text/plain; charset=utf-8', t || '');
  }

  // app.wxss
  if (p === '/api/appwxss') {
    const t = readSafe(ROOT, 'app.wxss');
    return send(res, 200, 'text/plain; charset=utf-8', t || '');
  }

  // 公共模块
  if (p === '/api/module') {
    const name = u.searchParams.get('path') || '';
    const t = readSafe(ROOT, name);
    return t ? send(res, 200, 'text/plain; charset=utf-8', t) : send(res, 404, 'text/plain', '');
  }

  // 页面四件套
  if (p === '/api/page') {
    const name = u.searchParams.get('path') || '';
    const base = path.resolve(ROOT, name);
    if (!base.startsWith(path.resolve(ROOT))) {
      return send(res, 403, MIME['.json'], '{"error":"forbidden"}');
    }
    const read = (ext) => {
      try { return fs.readFileSync(base + ext, 'utf8'); } catch (e) { return ''; }
    };
    return send(res, 200, MIME['.json'], JSON.stringify({
      json: read('.json'),
      wxml: read('.wxml'),
      wxss: read('.wxss'),
      js: read('.js')
    }));
  }

  // 小程序图片资源
  if (p.startsWith('/images/')) {
    const rel = p.slice(1);
    const full = path.resolve(ROOT, rel);
    if (!full.startsWith(path.resolve(ROOT) + path.sep)) return send(res, 403, 'text/plain', 'forbidden');
    try {
      const body = fs.readFileSync(full);
      return send(res, 200, MIME[path.extname(full)] || 'application/octet-stream', body);
    } catch (e) {
      return send(res, 404, 'text/plain', 'not found: ' + rel);
    }
  }

  // 静态资源
  const file = p === '/' ? 'player.html' : p.slice(1);
  const full = path.resolve(HERE, file);
  if (!full.startsWith(path.resolve(HERE))) return send(res, 403, 'text/plain', 'forbidden');

  try {
    const body = fs.readFileSync(full);
    send(res, 200, MIME[path.extname(full)] || 'application/octet-stream', body);
  } catch (e) {
    send(res, 404, 'text/plain', 'not found: ' + file);
  }
}

const server = http.createServer(handle);

function listen(port, tries = 0) {
  server.listen(port, '127.0.0.1', () => {
    console.log('PREVIEW_URL=http://127.0.0.1:' + port);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries < 20) {
      listen(port + 1, tries + 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  });
}

if (require.main === module) listen(Number(process.env.PORT) || 5199);
module.exports = { handle };
