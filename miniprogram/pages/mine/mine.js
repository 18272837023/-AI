const api = require('../../utils/service.js');

Page({
  data: { api: '', count: '—', isTemporaryTest: false,description:'' },
  onShow() {
    const app = getApp();
    const base = (app && app.globalData && app.globalData.apiBaseUrl) || '';
    const cloud=app.globalData.cloudHosting;
    const isCloud=!!cloud?.enabled&&typeof wx.cloud?.callContainer==='function';
    this.setData({api:isCloud?'微信云托管 · '+cloud.service:base,description:isCloud?'项目和文件保存在云端，按微信账号分别管理。':'项目数据保存在下方地址对应的服务端；当前连接使用共享测试空间。',isTemporaryTest:!isCloud&&/^https:\/\/[^/]+\.trycloudflare\.com(?:\/|$)/.test(base)});
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
