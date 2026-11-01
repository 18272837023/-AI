Page({
  data: {},
  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },
  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' });
  }
});
