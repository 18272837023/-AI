const api=require('../../utils/service.js');
Page({data:{project:{modeEvidence:{}},outline:[],stats:{},mode:'free',canEdit:true,busy:false},
 onShow(){return api.action(this,()=>this.load());},
 async load(){const t=await api.ensure('blueprint','blueprint');this._revision=t.revision;const v=api.view(t);this.setData({...v,mode:v.project.outlineMode,canEdit:true});},
 change(body){return api.action(this,async()=>{await api.request(api.path()+'/chapters','POST',{revision:this._revision,...body});await this.load();wx.showToast({title:'大纲已保存',icon:'success'});});},
 addChapter(){if(this._busy)return;wx.showModal({title:'新增章节',editable:true,placeholderText:'请输入章节标题',content:'',success:r=>{if(r.confirm)this.change({action:'add',title:r.content||''});}});},
 manage(e){if(this._busy)return;const index=Number(e.currentTarget.dataset.index),row=this.data.outline[index];if(!row)return;
  wx.showActionSheet({itemList:['修改标题','上移一章','下移一章','删除章节'],success:r=>{
   if(r.tapIndex===0)wx.showModal({title:'修改章节标题',editable:true,content:row.title,success:v=>{if(v.confirm)this.change({action:'rename',scoreId:row.id,title:v.content||''});}});
   if(r.tapIndex===1||r.tapIndex===2){const next=index+(r.tapIndex===1?-1:1);if(next<0||next>=this.data.outline.length)return wx.showToast({title:'已在最前或最后',icon:'none'});this.change({action:'move',scoreId:row.id,index:next});}
   if(r.tapIndex===3)wx.showModal({title:'删除本次技术标章节？',content:'将移除“'+row.title+'”及其关联要素、正文。原始招标文件保留；删除误识别的综合标章节后，技术评分合计会同步更新。',confirmText:'确认删除',success:v=>{if(v.confirm)this.change({action:'remove',scoreId:row.id});}});
  }});
 },
 openChapter(e){const row=this.data.outline[Number(e.currentTarget.dataset.index)],sections=api.session.tender.sections||[],index=sections.findIndex(s=>String(s.scoreId)===String(row?.id));if(index<0)return wx.showToast({title:'本章尚未生成正文',icon:'none'});api.session.chapter=index;wx.navigateTo({url:'/pages/chapter/chapter'});},
 startGenerate(){if(this._busy)return;if(!this.data.outline.length){wx.showToast({title:'大纲尚未准备好，请重新打开此页',icon:'none'});return;}if(this.data.outline.some(row=>!row.custom&&!(row.score>0))){wx.navigateTo({url:'/pages/analysis/analysis'});return;}wx.navigateTo({url:'/pages/generating/generating'});}
});
