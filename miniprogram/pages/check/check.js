const api = require('../../utils/service.js');
const cats = { qual: '合格性覆盖', cover: '要素覆盖', compliance: '合规核验', placeholder: '内容完整性', style: '文风检测', supplement: '待补资料', source: '招标解析',outline:'人工大纲' };
const MAX_ROUNDS = 3;
// 可自动修复的「处数」：一条问题可能包含多个待补点（count），按处数才看得出进展
function autoLoad(check) {
  return ((check && check.items) || []).filter(i => i.level !== 'pass' && i.fixType === 'auto').reduce((n, i) => n + (i.count || 1), 0);
}
function remainingHint(check){
  if(check.auto)return `仍有 ${check.auto} 项可由 AI 优化，请按清单重试对应项。`;
  const manual=(check.items||[]).filter(i=>i.level==='block');
  if(manual.some(i=>i.id==='C5'))return '请到待补资料填写真实参数，保存后重新自检。';
  if(manual.some(i=>i.cat==='supplement'))return '请到待补资料补充真实资料，再重新自检。';
  if(manual.length)return '请按清单核对并修改对应内容，再重新自检。';
  return check.warning?`可以导出，仍有 ${check.warning} 项提醒需核对。`:'可以导出了。';
}
Page({
  data: {
    check: { items: [], blocking: 0, auto: 0 },
    filters: [{ key: 'all', name: '全部' }, { key: 'block', name: '阻断' }, { key: 'warn', name: '警告' }, { key: 'pass', name: '通过' }],
    filter: 'all', shown: [], running: false, progress: 0, jobLabel: '',
    optimizing: false, activeIssueId: '', lastRun: null
  },
  onShow() { this._unloaded = false; return api.action(this, () => this.load()); },
  onUnload() { this._unloaded = true; },
  async load() {
    await api.refresh();
    const check = await api.check();
    check.items = check.items.map(item => ({ ...item, catText: cats[item.cat] || item.cat, fixLabel: item.fixType === 'auto' ? 'AI 一键优化' : item.cat === 'source' ? '重新解析' : item.cat === 'supplement' || item.id === 'C5' ? '去填写' : '查看并修改' }));
    const shown = this.data.filter === 'all' ? check.items : check.items.filter(i => i.level === this.data.filter);
    this.setData({ check, shown });
    return check;
  },
  setFilter(e) { const key = e.currentTarget.dataset.key; this.setData({ filter: key, shown: key === 'all' ? this.data.check.items : this.data.check.items.filter(i => i.level === key) }); },
  primary(e) {
    if (this._busy || this.data.optimizing) return;
    const item = this.data.check.items.find(i => i.id === e.currentTarget.dataset.id);
    if (!item) return;
    if (item?.fixType === 'auto') return this.optimize(item.id);
    wx.navigateTo({ url: item?.cat === 'source' ? '/pages/analysis/analysis' : item?.cat === 'outline' ? '/pages/outline/outline' : item?.id === 'C5' || item?.cat === 'supplement' ? '/pages/fill/fill?from=check' : '/pages/chapter/chapter' });
  },
  /* 一键优化：跑 repair，若仍有可自动修复项就再来一轮（最多 3 轮），
     每轮都重新拉取自检结果，保证顶部数字和清单跟正文一致。 */
  optimize(issueId) {
    return api.action(this, async () => {
      const before = this.snapshot();
      this.setData({ optimizing: true, activeIssueId: issueId || '', progress: 0, jobLabel: '正在读取自检问题',lastRun:null });
      let rounds = 0, lastLoad = before.load;
      try {
        while (rounds < MAX_ROUNDS) {
          rounds += 1;
          await api.stage('repair', j => this.setData({ progress: j.progress || 0, jobLabel: j.label || '正在优化正文' }), this, issueId && rounds === 1 ? { issueId } : {});
          const c = await this.load();
          if (issueId) break;
          // 按「待修处数」判断进展，而不是条目数：
          // 一处 3 个占位符只修掉 2 个时条目仍是同一条，只看条目数会误判成没进展。
          const now = autoLoad(c);
          if (!now || now >= lastLoad) break;
          lastLoad = now;
          this.setData({ progress: 0, jobLabel: `还有 ${now} 处可自动修复，继续第 ${rounds + 1} 轮` });
        }
      } catch (e) {
        // 失败也要把已完成的部分同步到界面，避免「报错后数字还是旧的」
        await this.load().catch(() => {});
        const targets=(this.data.check.items||[]).filter(i=>i.level!=='pass'&&i.fixType==='auto'&&(!issueId||i.id===issueId));
        const guide=targets.some(i=>i.cat==='cover')?'对应章节尚未补写完成，已保存的正文会保留。请重试本项 AI 优化；如提示大纲缺失，请先回到大纲页确认。':targets.some(i=>i.cat==='placeholder')?'方案内容尚未补全，请重试 AI 优化；真实资料请在待补资料填写。':'本次优化未完成，已保存的正文会保留，请稍后重试并重新自检。';
        e.message=guide+'\n\n具体原因：'+e.message;
        throw e;
      } finally {
        this.setData({ optimizing: false, activeIssueId: '' });
      }
      const after = this.snapshot();
      const fixed = Object.keys(before.counts).reduce((n,id)=>n+Math.max(0,before.counts[id]-(after.counts[id]||0)),0);
      this.setData({ lastRun: { fixed, before: before.blocking, after: after.blocking, auto: after.auto, rounds,message:remainingHint(this.data.check) } });
      const left = after.blocking;
      wx.showModal({
        title: fixed ? (left < before.blocking ? `阻断降到 ${left} 项` : `已处理 ${fixed} 处`) : '本次未减少阻断',
        content: fixed
          ? `阻断 ${before.blocking} 项 → ${left} 项。${remainingHint(this.data.check)}`
          : `本次没有减少待修内容。${remainingHint(this.data.check)}`,
        showCancel: false
      });
    });
  },
  snapshot() {
    const items = this.data.check.items || [];
    const counts = {};
    for (const i of items) if (i.level !== 'pass') counts[i.id] = i.count || 1;
    return {
      blocking: this.data.check.blocking || 0,
      auto: this.data.check.auto || 0,
      load: autoLoad(this.data.check),
      ids: items.filter(i => i.level !== 'pass').map(i => i.id),
      counts
    };
  },
  fixAllAuto() { return this.optimize(); },
  rerun() { return this.onShow(); },
  goExport() { wx.navigateTo({ url: '/pages/export/export' }); }
});
