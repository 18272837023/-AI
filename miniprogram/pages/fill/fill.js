const api=require('../../utils/service.js');
function mergeDraft(data,draft){
 if(draft?.revision!==data.revision||!Array.isArray(draft.groups))return data.groups;
 return data.groups.map(g=>{const saved=draft.groups.find(x=>x.id===g.id);if(!saved?.entries?.length)return g;return {...g,declared:!!saved.declared,entries:saved.entries.slice(0,g.max).map((e,i)=>({id:g.id+'-draft-'+i,fields:g.entries[0].fields.map(f=>({...f,value:e.fields.find(x=>x.key===f.key)?.value||f.value}))}))};});
}
function fieldsOf(groups){return groups.filter(g=>!g.declared).flatMap(g=>g.entries.flatMap(e=>e.fields.filter(f=>f.type!=='label')));}
Page({
 data:{groups:[],stats:{groups:0},totalFields:0,filledCount:0,pendingCount:0,declaredCount:0,ready:false,loading:false,loadError:'',hasSections:false,busy:false},
 onLoad(){this._unloaded=false;},onUnload(){this._unloaded=true;},
 onShow(){this._unloaded=false;return api.action(this,async()=>{
  this.setData({loading:true,ready:false,loadError:''});
  try{await api.refresh();const data=await api.request(api.path()+'/supplements');if(this._unloaded)return;this._revision=data.revision;this._draftKey='fill-draft-'+api.path();const draft=wx.getStorageSync?.(this._draftKey);this.setData({groups:mergeDraft(data,draft),stats:data.stats,hasSections:data.hasSections,ready:true});this.refresh();}
  catch(e){if(!this._unloaded)this.setData({loadError:e.message});throw e;}finally{if(!this._unloaded)this.setData({loading:false});}
 });},
 retry(){return this.onShow();},
 locate(d){const gi=this.data.groups.findIndex(g=>g.id===d.g);if(gi<0)return null;const ei=this.data.groups[gi].entries.findIndex(e=>e.id===d.e);if(ei<0)return null;const fi=this.data.groups[gi].entries[ei].fields.findIndex(f=>f.key===d.k);return fi<0?null:{gi,ei,fi};},
 onInput(e){const p=this.locate(e.currentTarget.dataset);if(!p)return;this.setData({['groups['+p.gi+'].entries['+p.ei+'].fields['+p.fi+'].value']:e.detail.value});this.refresh();},
 pick(e){this.onInput({currentTarget:e.currentTarget,detail:{value:e.currentTarget.dataset.v}});},
 refresh(){if(this.data.ready&&this._draftKey)wx.setStorageSync?.(this._draftKey,{revision:this._revision,groups:this.data.groups});const inputs=fieldsOf(this.data.groups);this.setData({totalFields:inputs.length,filledCount:inputs.filter(f=>f.value.trim()).length,pendingCount:inputs.filter(f=>f.required&&!f.value.trim()).length,declaredCount:this.data.groups.filter(g=>g.declared).length});},
 addEntry(e){if(this._busy)return;const gi=this.data.groups.findIndex(g=>g.id===e.currentTarget.dataset.id),g=this.data.groups[gi];if(!g?.repeat||g.entries.length>=g.max)return;const entry={id:g.id+'-new-'+Date.now(),fields:g.entries[0].fields.map(f=>({...f,value:''}))};this.setData({['groups['+gi+'].entries']:g.entries.concat(entry)});this.refresh();},
 removeEntry(e){if(this._busy)return;const gi=this.data.groups.findIndex(g=>g.id===e.currentTarget.dataset.g);if(gi<0)return;const g=this.data.groups[gi];if(g.entries.length<=1)return;this.setData({['groups['+gi+'].entries']:g.entries.filter(x=>x.id!==e.currentTarget.dataset.e)});this.refresh();},
 declare(e){if(this._busy)return;const gi=this.data.groups.findIndex(g=>g.id===e.currentTarget.dataset.id),g=this.data.groups[gi];if(!g?.canDeclare)return;
  const previous=g.declared;
  const apply=()=>api.action(this,async()=>{this.setData({['groups['+gi+'].declared']:!previous});this.refresh();try{const result=await api.request(api.path()+'/supplements','PUT',{revision:this._revision,groups:this.data.groups});this._revision=result.revision;this.setData({groups:result.groups});this.refresh();wx.showToast({title:'声明已保存，自检已更新',icon:'none'});}catch(err){this.setData({['groups['+gi+'].declared']:previous});this.refresh();throw err;}});
  if(g.declared)return apply();
  wx.showModal({title:'声明未提供或不适用？',content:'该项会保留风险提醒；招标文件的强制要求和未填的真实参数不会因此自动通过自检。',success:r=>{if(r.confirm)apply();}});
 },
 polish(e){return api.action(this,async()=>{
  const gi=this.data.groups.findIndex(g=>g.id===e.currentTarget.dataset.id);if(gi<0)return;
  this.setData({['groups['+gi+'].busy']:true});
  try{const result=await api.request(api.path()+'/supplements/training-draft','POST',{});if(this._unloaded)return;
   const group=this.data.groups[gi];
   wx.showModal({title:'培训计划建议已生成',content:result.notice+' 确认后替换当前未保存的培训条目。',success:r=>{if(!r.confirm)return;this.setData({['groups['+gi+'].entries']:result.items.map((row,i)=>({id:group.id+'-draft-'+i,fields:group.entries[0].fields.map(f=>({...f,value:row[f.key]||''}))}))});this.refresh();}});
  }finally{if(!this._unloaded)this.setData({['groups['+gi+'].busy']:false});}
 });},
 restore(){wx.showModal({title:'重新载入？',content:'将放弃本页尚未保存的修改，恢复本机已保存的信息。',success:r=>{if(r.confirm)this.onShow();}});},
 clearAll(){wx.showModal({title:'清空本页填写？',content:'尚未保存，保存后只更新对应的补充内容，不会重写其他正文。',success:r=>{if(!r.confirm)return;this.setData({groups:this.data.groups.map(g=>({...g,declared:false,entries:[{...g.entries[0],fields:g.entries[0].fields.map(f=>({...f,value:''}))}]}))});this.refresh();}});},
 save(){return api.action(this,async()=>{
  const result=await api.request(api.path()+'/supplements','PUT',{revision:this._revision,groups:this.data.groups});this._revision=result.revision;wx.removeStorageSync?.(this._draftKey);
  const t=await api.refresh();const next=()=>wx.redirectTo({url:t.sections?.length?'/pages/chapter/chapter':'/pages/generating/generating'});
  if(result.warnings.length)wx.showModal({title:'信息已保存，请核对',content:result.warnings.join('\n'),showCancel:false,success:next});else next();
 });}
});
