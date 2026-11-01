'use strict';

const config = require('./config');
const store = require('./lib/store');
const queue = require('./lib/queue');
const { createRouter, sendJson } = require('./lib/http');
const { routes } = require('./api');
const { logger } = require('./lib/util');

/**
 * 启动入口。顺序有讲究：先 load 数据（会把上次残留的 running job 标成 failed），
 * 再起队列，最后监听端口——否则重启瞬间进来的请求可能读到半加载状态。
 */

store.load();
queue.configure(config.queue.concurrency);

const HELP = `AI 技术标 · P0 服务端

GET  /v1/health
POST /v1/tenders                      { name }
GET  /v1/tenders
GET  /v1/tenders/:id[?slim=1]
POST /v1/tenders/:id/files            multipart 或 raw + header x-filename
POST /v1/tenders/:id/parse            解析：M01→M02→M04→M05→M06→M07
POST /v1/tenders/:id/blueprint        施工图：M09
POST /v1/tenders/:id/elements         要素表：M13
POST /v1/tenders/:id/generate         正文：M14（跑完自动自检）
POST /v1/tenders/:id/check            自检：M17/M18/M19（同步，纯规则）
GET  /v1/jobs/:jobId                  轮询任务进度
GET  /v1/tenders/:id/jobs
`;

const server = createRouter(routes, {
  beforeRequest: require('./test-access').testAccess(),
  onNotFound(req, res, url) {
    if (!url.pathname.startsWith('/v1')) return require('../../tools/preview/server').handle(req, res);
    if (url.pathname === '/' || url.pathname === '/v1') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(HELP);
    }
    sendJson(res, 404, { ok: false, error: { message: '没有这个接口：' + req.method + ' ' + url.pathname } });
  }
});

server.listen(config.port, config.host, () => {
  logger.info(`服务已启动 http://${config.host}:${config.port}`);
  logger.info(`模型模式：${config.llm.live ? 'live / ' + config.llm.model : 'mock（规则基线，不调模型）'}`);
  logger.info(`队列并发：${config.queue.concurrency}`);
});

function shutdown(signal) {
  logger.info(`收到 ${signal}，落盘后退出`);
  try {
    store.flush();
  } catch (e) {
    logger.error('落盘失败', e.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
