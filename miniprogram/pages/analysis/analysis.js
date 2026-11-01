const api = require('../../utils/service.js');
Page({data:{project:{files:[],modeEvidence:{}},quals:[],qualStats:{cats:[]},scoreItems:[],blueprintStats:{},outline:[],tab:0,tabs:['项目要素','合格性审查','技术标评分','大纲','风险'],scoreSplit:[],techRisks:[],degraded:false,editing:false,editJson:''},
 onShow(){api.action(this,async()=>{const t=await api.refresh();this._revision=t.revision;this.setData(api.view(t));});},
 reparse(){wx.showModal({title:'重新解析招标文件？',content:'将重读评分表并重建后续内容。旧正文自动留存备份，已填写的真实资料保留。',success:r=>{if(r.confirm)api.action(this,async()=>{const t=await api.stage('rescore',j=>wx.showToast({title:j.label,icon:'none'}),this);this._revision=t.revision;this.setData(api.view(t));});}});},
 editParse(){this.setData({editing:true,editJson:JSON.stringify(api.session.tender.parse,null,2)});},
 onJson(e){this.setData({editJson:e.detail.value});},
 saveParse(){api.action(this,async()=>{const t=await api.save('parse',JSON.parse(this.data.editJson),this._revision);this._revision=t.revision;this.setData({...api.view(t),editing:false});});},
 switchTab(e){this.setData({tab:Number(e.currentTarget.dataset.index)});},
 exportReport(){wx.showModal({title:'解析报告',content:'当前可在本页核对解析结果；Word 导出位于正文后的导出页。',showCancel:false});},
 goBlueprint(){this.confirm();},goOutline(){wx.navigateTo({url:'/pages/outline/outline'});},
 confirm(){if(this.data.project.techScore<=0){this.reparse();return;}api.action(this,async()=>{await api.ensure('blueprint','blueprint',j=>wx.showToast({title:j.label,icon:'none'}));wx.navigateTo({url:'/pages/blueprint/blueprint'});});}
});
