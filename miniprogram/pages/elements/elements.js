const api=require('../../utils/service.js');
function groupsOf(t){return (t.elements||[]).map((g,i)=>({id:'G'+i,scoreId:g.scoreId,el:g.scoreId,name:g.item,chapter:g.item,canDeclare:false,repeat:false,aiPolish:false,hint:'参数须依据真实资料填写，未知信息请保留〔待确认〕。',entries:g.rows.map((r,j)=>({id:'R'+j,elementId:r.elementId,name:r.name,fields:[['approach','具体做法'],['params','参数与指标'],['owner','责任岗位'],['frequency','实施频次']].map(([key,label])=>({key,label,value:r[key],ph:'请填写真实信息'}))}))}));}
Page({data:{groups:[],stats:{groups:0},totalFields:0,filledCount:0,declaredCount:0,pendingCount:0,ready:false,loading:false,jobLabel:'',jobProgress:0,loadError:'',busy:false},
 onLoad(){this._unloaded=false;},
 onUnload(){this._unloaded=true;},
 onShow(){this._unloaded=false;return api.action(this,async()=>{
  this.setData({loading:true,ready:false,loadError:'',jobLabel:'正在读取已保存的要素表…',jobProgress:0});
  try {
   const t=await api.ensure('elements','elements',j=>{if(!this._unloaded)this.setData({jobLabel:j.label,jobProgress:j.progress});},this);
   if(this._unloaded)return;
   this._revision=t.revision;this._elements=JSON.parse(JSON.stringify(t.elements||[]));
   this.setData({groups:groupsOf(t),stats:{groups:(t.elements||[]).length},ready:true,jobProgress:100});this.refresh();
  }catch(e){if(!this._unloaded)this.setData({loadError:e.message});throw e;}
  finally{if(!this._unloaded)this.setData({loading:false});}
 });},
 retry(){return this.onShow();},
 onInput(e){const d=e.currentTarget.dataset;const gi=this.data.groups.findIndex(g=>g.id===d.g),ei=this.data.groups[gi].entries.findIndex(x=>x.id===d.e),fi=this.data.groups[gi].entries[ei].fields.findIndex(f=>f.key===d.k);this.setData({['groups['+gi+'].entries['+ei+'].fields['+fi+'].value']:e.detail.value});this.refresh();},
 refresh(){const fields=this.data.groups.flatMap(g=>g.entries.flatMap(e=>e.fields));this.setData({totalFields:fields.length,filledCount:fields.filter(f=>f.value.trim()&&!/待确认/.test(f.value)).length,pendingCount:fields.filter(f=>!f.value.trim()||/待确认/.test(f.value)).length});},
 restore(){this.onShow();},clearAll(){wx.showModal({title:'清空当前表单？',content:'尚未保存的修改将被清空。',success:r=>{if(r.confirm){this.setData({groups:this.data.groups.map(g=>({...g,entries:g.entries.map(e=>({...e,fields:e.fields.map(f=>({...f,value:''}))}))}))});this.refresh();}}});},
 save(){api.action(this,async()=>{if(!this._elements.length)throw Error('请先生成要素表');const value=JSON.parse(JSON.stringify(this._elements));this.data.groups.forEach((g,i)=>g.entries.forEach((e,j)=>e.fields.forEach(f=>value[i].rows[j][f.key]=f.value)));
 if(JSON.stringify(value)!==JSON.stringify(this._elements)){await api.save('elements',value,this._revision);await api.stage('generate',j=>wx.showToast({title:j.label,icon:'none'}));}
 else await api.ensure('generate','sections');wx.redirectTo({url:'/pages/chapter/chapter'});});}
});
