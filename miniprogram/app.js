App({
  globalData: {
    userInfo: null,
    apiBaseUrl: 'http://127.0.0.1:5310',
    // 当前项目（MVP 阶段用内存数据串起主链路，后续替换为后端接口）
    currentProject: null
  },

  onLaunch() {
    console.log('[AI标书] 小程序启动');
  },

  onShow() {},

  onError(err) {
    console.error('[AI标书] 全局错误', err);
  }
});
