'use strict';

const { logger } = require('./util');

/**
 * 单机任务队列。
 *
 * 为什么需要队列而不是"请求里直接跑"：
 * 小程序 wx.request 超时 60s，而一份技术标解析 + 生成要几分钟。
 * 所以接口只负责建 job 立刻返回，真正的活在这里串行跑，前端轮询 job 状态。
 *
 * P0 用内存队列：进程挂了任务丢失（store 会把它标成 failed）。
 * 换 BullMQ / Redis 时保持 enqueue + 事件签名不变即可。
 */

const pending = [];
let running = 0;
let concurrency = 2;

function configure(n) {
  concurrency = Math.max(1, Number(n) || 1);
}

function size() {
  return { pending: pending.length, running };
}

function enqueue(task) {
  pending.push(task);
  pump();
}

function pump() {
  while (running < concurrency && pending.length) {
    const task = pending.shift();
    running += 1;
    Promise.resolve()
      .then(() => task.run())
      .catch((e) => {
        logger.error('任务异常', e && e.message);
        if (typeof task.onError === 'function') task.onError(e);
      })
      .finally(() => {
        running -= 1;
        if (typeof task.onDone === 'function') task.onDone();
        pump();
      });
  }
}

module.exports = { configure, enqueue, size, pump };
