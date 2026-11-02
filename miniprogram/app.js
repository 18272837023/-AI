App({
  globalData: {
    userInfo: null,
    cloudHosting: require('./utils/cloud-config'),
    // 浏览器本地预览的备用地址；真机使用 cloudHosting 配置。
    apiBaseUrl: 'http://127.0.0.1:5310',
    // 当前打开的项目，由服务端接口刷新。
    currentProject: null
  },

  onLaunch() {
    if(this.globalData.cloudHosting.enabled&&typeof wx!=='undefined'&&wx.cloud)wx.cloud.init({env:this.globalData.cloudHosting.env});
    console.log('[AI标书] 小程序启动');
  },

  onShow() {},

  onError(err) {
    console.error('[AI标书] 全局错误', err);
  }
});
