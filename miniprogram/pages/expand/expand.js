const api=require('../../utils/service.js');
Page({data:{targetPages:'',plan:null,busy:false,progress:0,label:'',result:''},
 onShow(){api.action(this,async()=>{const t=await api.refresh(),words=(t.sections||[]).reduce((n,s)=>n+(s.wordCount||0),0);if(!this.data.targetPages)this.setData({targetPages:String(Math.min(300,Math.max(20,Math.ceil(words/420*1.5))))});await this.loadPlan();});},
 onPages(e){this.setData({targetPages:e.detail.value,plan:null,result:''});},
 async loadPlan(){const n=Number(this.data.targetPages);if(!Number.isInteger(n)||n<1||n>300)throw Error('请输入 1—300 的整数页数');const plan=await api.request(api.path()+'/expansion-plan?targetPages='+n);this.setData({plan});return plan;},
 preview(){return api.action(this,()=>this.loadPlan());},
 start(){return api.action(this,async()=>{const plan=await this.loadPlan();if(plan.addWords<100)throw Error('现有篇幅已达到目标，请提高目标总页数');let outcome;await api.stage('expand',j=>{this.setData({progress:j.progress||0,label:j.label});if(j.result)outcome=j.result;},this,{targetPages:Number(this.data.targetPages)});this.setData({progress:100,result:outcome?.failed?.length?'部分章节扩写完成；'+outcome.failed.map(f=>f.title+'：'+f.error).join('；'):'全稿扩写完成，请检查正文和最终排版。'});await this.loadPlan();});},
 goChapter(){wx.navigateBack();},
 onUnload(){this._unloaded=true;}
});
