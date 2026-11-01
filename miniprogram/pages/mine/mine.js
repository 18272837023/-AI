const api = require('../../utils/service.js');

Page({
  data: { api: '', count: '—', isTemporaryTest: false },
  onShow() {
    const app = getApp();
    const base = (app && app.globalData && app.globalData.apiBaseUrl) || '';
    this.setData({ api: base, isTemporaryTest: /^https:\/\/[^/]+\.trycloudflare\.com(?:\/|$)/.test(base) });
    api.action(this, async () => {
      const rows = await api.request('/v1/tenders');
      this.setData({ count: (rows || []).length + ' 个' });
    }).catch(() => this.setData({ count: '服务未连接' }));
  },
  resetTestAccess() {
    try {
      wx.removeStorageSync('temporaryTestAccessToken');
      delete getApp().globalData.apiAccessToken;
      wx.switchTab({ url: '/pages/index/index' });
    } catch (e) { api.error(e); }
  },
  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});
