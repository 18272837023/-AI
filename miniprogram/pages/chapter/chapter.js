const api=require('../../utils/service.js');
Page({data:{chapter:{elements:[],blocks:[]},chapters:[],chapterIndex:0,doneCount:0,editing:false,editText:'',fillPending:0,editBlocks:[],savedAt:''},
 onShow(){if(this.data.editing)return;api.action(this,async()=>{const t=await api.refresh();this._revision=t.revision;this._sections=JSON.parse(JSON.stringify(t.sections||[]));if(!this._sections.length)throw Error('请先生成正文');this.showChapter(Math.min(api.session.chapter,this._sections.length-1));});},
 showChapter(i){api.session.chapter=i;wx.setNavigationBarTitle({title:'正文编辑'});const t=api.session.tender,v=api.view(t),sec=this._sections[i],score=v.scoreItems.find(s=>s.id===sec.scoreId);this.setData({chapterIndex:i,chapters:this._sections.map((s,n)=>({index:n,title:s.title})),chapter:{...sec,score:score?.score||0,scoreText:score?.scoreText||'分值待重新识别',tier:score?.tier||'',elements:score?.elements||[]},doneCount:score?.done||0,fillPending:t.supplements?.stats?.pending||0,savedAt:t.updatedAt.slice(11,19)});},
 pickChapter(e){if(this.data.editing){wx.showToast({title:'请先保存修改',icon:'none'});return;}this.showChapter(Number(e.currentTarget.dataset.index));},
 goFill(){wx.navigateTo({url:'/pages/fill/fill'});},
 toggleEdit(){this.setData({editing:true,editBlocks:JSON.parse(JSON.stringify(this.data.chapter.blocks))});},
 onBlockInput(e){this.setData({['editBlocks['+Number(e.currentTarget.dataset.index)+'].text']:e.detail.value});},
 onCellInput(e){const d=e.currentTarget.dataset;this.setData({['editBlocks['+d.block+'].rows['+d.row+']['+d.cell+']']:e.detail.value});},
 saveEdit(){api.action(this,async()=>{const sections=JSON.parse(JSON.stringify(this._sections));sections[this.data.chapterIndex].blocks=this.data.editBlocks;
 await api.save('sections',sections,this._revision);this.setData({editing:false});this._sections=JSON.parse(JSON.stringify(api.session.tender.sections));this._revision=api.session.tender.revision;this.showChapter(this.data.chapterIndex);wx.showToast({title:'已保存',icon:'success'});});},
 nextChapter(){if(this.data.editing){wx.showToast({title:'请先保存修改',icon:'none'});return;}this.showChapter((this.data.chapterIndex+1)%this._sections.length);},
 aiAction(e){if(this.data.editing){wx.showToast({title:'请先保存修改',icon:'none'});return;}return api.action(this,async()=>{this.setData({aiLabel:'AI 正在处理…'});try{const t=await api.stage('chapter-ai',j=>this.setData({aiLabel:j.label}),this,{scoreId:this.data.chapter.scoreId,action:e.currentTarget.dataset.key});this._revision=t.revision;this._sections=JSON.parse(JSON.stringify(t.sections));this.showChapter(this.data.chapterIndex);wx.showToast({title:'正文已更新',icon:'success'});}finally{this.setData({aiLabel:''});}});},
 goCheck(){wx.navigateTo({url:'/pages/check/check'});}
});
