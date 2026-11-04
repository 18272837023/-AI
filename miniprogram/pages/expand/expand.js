const api=require('../../utils/service.js');
Page({data:{targetPages:'',plan:null,busy:false,progress:0,label:'',result:'',planLoading:false,expanding:false,returnTarget:'chapter',returnLabel:'返回正文',error:'',refreshError:''},
 onLoad(options){this._unloaded=false;const from=options?.from==='export'?'export':'chapter';this.setData({returnTarget:from,returnLabel:from==='export'?'返回导出预览':'返回正文'});},
 onShow(){this._unloaded=false;return api.action(this,async()=>{this.setData({planLoading:true,error:''});try{const t=await api.refresh(),words=(t.sections||[]).reduce((n,s)=>n+(s.wordCount||0),0);if(this._unloaded)return;if(!this.data.targetPages)this.setData({targetPages:String(Math.min(300,Math.max(20,Math.ceil(words/420*1.5))))});await this.loadPlan();}catch(e){if(!this._unloaded)this.setData({error:e.message});throw e;}finally{if(!this._unloaded)this.setData({planLoading:false});}});},
 onPages(e){this.setData({targetPages:e.detail.value,plan:null,result:''});},
 async loadPlan(){const n=Number(this.data.targetPages);if(!Number.isInteger(n)||n<1||n>300)throw Error('请输入 1—300 的整数页数');const plan=await api.request(api.path()+'/expansion-plan?targetPages='+n);if(!this._unloaded)this.setData({plan});return plan;},
 preview(){return api.action(this,async()=>{this.setData({planLoading:true,error:''});try{return await this.loadPlan();}catch(e){if(!this._unloaded)this.setData({error:e.message});throw e;}finally{if(!this._unloaded)this.setData({planLoading:false});}});},
 start(){if(this._busy)return;return api.action(this,async()=>{this.setData({expanding:true,progress:0,label:'正在准备全稿扩写任务…',result:'',error:'',refreshError:''});try{const plan=await this.loadPlan();if(this._unloaded)return;if(plan.addWords<100)throw Error('现有篇幅已达到目标，请提高目标总页数');let outcome;
 await api.stage('expand',j=>{if(this._unloaded)return;this.setData({progress:Math.max(0,Math.min(100,Math.round(j.progress||0))),label:j.status==='done'?'正在刷新章节与字数预览…':j.label||'正在扩写正文…'});if(j.result)outcome=j.result;},this,{targetPages:Number(this.data.targetPages)});
 if(this._unloaded)return;this.setData({progress:100,label:'正在刷新章节与字数预览…'});try{await this.loadPlan();}catch(_){if(!this._unloaded)this.setData({plan:null,refreshError:'扩写结果已保存，篇幅信息暂未刷新，请返回预览重新载入。'});}if(this._unloaded)return;
 const failed=outcome?.failed||[];this.setData({result:failed.length?'部分章节扩写完成；'+failed.map(f=>f.title+'：'+f.error).join('；'):this.data.refreshError?'全稿扩写完成，结果已保存。':'全稿扩写完成，章节和字数已更新。',returnLabel:this.data.returnTarget==='export'?'查看导出预览':'查看更新后的正文'});
 if(!failed.length&&!this.data.refreshError){wx.showToast({title:'扩写完成',icon:'success'});this.goChapter(true);}
 }catch(e){if(!this._unloaded)this.setData({error:e.message,label:'扩写未完成，请重试'});throw e;}finally{if(!this._unloaded)this.setData({expanding:false});}});},
 goChapter(completed){if(this._busy&&completed!==true)return;const target=this.data.returnTarget==='export'?'export':'chapter';wx.navigateBack({delta:1,fail:()=>wx.redirectTo({url:'/pages/'+target+'/'+target})});},
 blockInteraction(){},
 onUnload(){this._unloaded=true;}
});
