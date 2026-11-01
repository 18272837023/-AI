const api=require('../../utils/service.js');
Page({data:{project:{modeEvidence:{}},outline:[],stats:{},mode:'free',canEdit:false},
 onShow(){api.action(this,async()=>{const v=api.view(await api.refresh());this.setData({...v,mode:v.project.outlineMode,canEdit:false});});},
 addChapter(){wx.showModal({title:'当前测试范围',content:'目前按评分项组织章节。请核对招标文件指定目录；严格大纲还需人工核对，暂不支持增删章节。',showCancel:false});},
 openChapter(e){api.session.chapter=Number(e.currentTarget.dataset.index)||0;wx.navigateTo({url:'/pages/chapter/chapter'});},
 checkSheet(){wx.navigateTo({url:'/pages/blueprint/blueprint'});},
 startGenerate(){wx.navigateTo({url:'/pages/generating/generating'});}
});
