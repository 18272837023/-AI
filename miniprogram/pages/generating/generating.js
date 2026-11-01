const api=require('../../utils/service.js');
Page({data:{percent:0,stage:0,phaseText:'连接服务…',fillCount:0,chapters:[],error:'',busy:false},
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
  if(!this._unloaded){this.setData({percent:100,stage:3,phaseText:'生成完成',chapters:api.generationChapters(t)});this._finishTimer=setTimeout(()=>{if(!this._unloaded)wx.redirectTo({url:'/pages/fill/fill'});},700);}
 }catch(e){if(!this._unloaded)this.setData({error:e.message,phaseText:'生成未完成，请重试'});throw e;}});},
 toBackground(){wx.switchTab({url:'/pages/projects/projects'});}
});
