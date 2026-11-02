const api=require('../../utils/service.js');
const hasSheet=(t,id)=>{const bp=t.blueprint?.find(b=>String(b.scoreId)===String(id)),group=t.elements?.find(g=>String(g.scoreId)===String(id));return !!bp&&!!group&&bp.elements.every(e=>group.rows?.some(r=>r.elementId===e.id));};
const hasBody=(t,id)=>t.sections?.some(s=>String(s.scoreId)===String(id)&&s.blocks?.some(b=>b.type!=='h4'&&(b.text?.trim()||b.rows?.length)));
Page({data:{percent:0,stage:0,phaseText:'连接服务…',fillCount:0,chapters:[],error:'',busy:false,activeRetryId:''},
 onLoad(){this._unloaded=false;this.start();},
 onUnload(){this._unloaded=true;if(this._finishTimer)clearTimeout(this._finishTimer);},
 start(){return api.action(this,async()=>{try{
  let t=await api.refresh();
  if(this._unloaded)return;
  this.setData({percent:0,stage:0,chapters:api.generationChapters(t),error:'',phaseText:'准备生成…'});
  t=await api.ensure('elements','elements',j=>{if(!this._unloaded)this.setData({percent:Math.round(j.progress/2),stage:1,phaseText:j.label,chapters:api.generationChapters(t,j)});},this);
  if(this._unloaded)return;
  if(!api.stageReady(t,'elements')){this.setData({percent:Math.min(49,Math.round((t.elements||[]).length/(t.blueprint.length||1)*50)),stage:1,phaseText:'部分要素表未完成',error:'部分评分项的要素表生成失败。点击重试，仅补齐失败项，保留已完成内容。',chapters:api.generationChapters(t)});return;}
  this.setData({percent:50,stage:2,phaseText:'准备展开正文…',chapters:api.generationChapters(t)});
  t=await api.ensure('generate','sections',j=>{if(!this._unloaded)this.setData({percent:50+Math.round(j.progress/2),stage:2,phaseText:j.label,chapters:api.generationChapters(t,j)});},this);
  if(!this._unloaded&&!api.stageReady(t,'sections')){const missing=t.blueprint.filter(bp=>!(t.sections||[]).some(s=>String(s.scoreId)===String(bp.scoreId)&&s.blocks?.some(b=>b.type!=='h4'&&b.text?.trim())));this.setData({percent:Math.min(99,50+Math.round((t.blueprint.length-missing.length)/t.blueprint.length*50)),stage:2,phaseText:'部分章节未完成',error:missing.map(x=>'「'+x.item+'」').join('、')+'尚未生成完成。点击重试，仅补写失败章节，保留其他正文。',chapters:api.generationChapters(t)});return;}
 if(!this._unloaded)this.finish(t);
 }catch(e){if(!this._unloaded)this.setData({error:e.message,phaseText:'生成未完成，请重试'});throw e;}});},
 finish(t){this.setData({percent:100,stage:3,phaseText:'生成完成',error:'',chapters:api.generationChapters(t)});this._finishTimer=setTimeout(()=>{if(!this._unloaded)wx.redirectTo({url:'/pages/fill/fill'});},700);},
 retryChapter(e){const id=e.currentTarget.dataset.id;if(!id||this._busy)return;return api.action(this,async()=>{
  this.setData({activeRetryId:id,error:'',phaseText:'正在重试所选章节…'});let t;
  try{
   t=await api.refresh();if(!t.blueprint?.some(bp=>String(bp.scoreId)===String(id)))throw Error('章节已变化，请重新打开项目');
   if(!hasSheet(t,id)){t=await api.stage('elements',j=>{if(!this._unloaded)this.setData({stage:1,percent:Math.round((j.progress||0)/2),chapters:api.generationChapters(t,j),phaseText:j.label});},this,{retryFailed:true,scoreId:id});if(!hasSheet(t,id))throw Error(t.elementsMeta?.failed?.find(f=>String(f.scoreId)===String(id))?.error||'本章要素表仍未完成，请重试本章');}
   if(!hasBody(t,id)){t=await api.stage('generate',j=>{if(!this._unloaded)this.setData({stage:2,percent:50+Math.round((j.progress||0)/2),chapters:api.generationChapters(t,j),phaseText:j.label});},this,{retryFailed:true,scoreId:id});if(!hasBody(t,id))throw Error(t.generateMeta?.failed?.find(f=>String(f.scoreId)===String(id))?.error||'本章正文仍未完成，请重试本章');}
   if(this._unloaded)return;
   if(api.stageReady(t,'sections'))this.finish(t);else this.setData({chapters:api.generationChapters(t),phaseText:'所选章节已完成',error:'本章已补齐。其他未完成章节可单独重试，也可点击底部继续生成。'});
  }catch(err){if(!this._unloaded){t=await api.refresh().catch(()=>t);const rows=t?api.generationChapters(t):this.data.chapters;this.setData({chapters:rows.map(r=>String(r.id)===String(id)&&r.status!=='ok'?{...r,status:'error',canRetry:true,errorText:err.message,statusText:'本章未完成，可再次重试'}:r),error:err.message,phaseText:'所选章节尚未完成'});}throw err;}
  finally{if(!this._unloaded)this.setData({activeRetryId:''});}
 });},
 toBackground(){wx.switchTab({url:'/pages/projects/projects'});}
});
