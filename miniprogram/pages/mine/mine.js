const api = require('../../utils/service.js');

Page({
  data: { api: '', count: '—' },
  onShow() {
    const app = getApp();
    this.setData({ api: (app && app.globalData && app.globalData.apiBaseUrl) || '' });
    api.action(this, async () => {
      const rows = await api.request('/v1/tenders');
      this.setData({ count: (rows || []).length + ' 个' });
    }).catch(() => this.setData({ count: '服务未连接' }));
  },
  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
