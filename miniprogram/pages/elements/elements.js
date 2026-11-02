const api=require('../../utils/service.js');
function groupsOf(t){return (t.elements||[]).map((g,i)=>({id:'G'+i,scoreId:g.scoreId,el:g.scoreId,name:g.item,chapter:g.item,canDeclare:false,repeat:false,aiPolish:false,hint:'参数须依据真实资料填写，未知信息请保留〔待确认〕。',entries:g.rows.map((r,j)=>({id:'R'+j,elementId:r.elementId,name:r.name,fields:[['approach','具体做法'],['params','参数与指标'],['owner','责任岗位'],['frequency','实施频次']].map(([key,label])=>({key,label,value:r[key],ph:'请填写真实信息'}))}))}));}
Page({data:{groups:[],facts:[],pendingLinks:[],onlyPending:false,stats:{groups:0},totalFields:0,filledCount:0,declaredCount:0,pendingCount:0,ready:false,loading:false,jobLabel:'',jobProgress:0,loadError:'',busy:false},
 onLoad(options){this._unloaded=false;this.setData({onlyPending:options?.pending==='1'});},
 onUnload(){this._unloaded=true;},
 onShow(){this._unloaded=false;return api.action(this,async()=>{
  this.setData({loading:true,ready:false,loadError:'',jobLabel:'正在读取已保存的要素表…',jobProgress:0});
  try {
   const t=await api.ensure('elements','elements',j=>{if(!this._unloaded)this.setData({jobLabel:j.label,jobProgress:j.progress});},this);
   if(this._unloaded)return;
   this._revision=t.revision;this._elements=JSON.parse(JSON.stringify(t.elements||[]));
   this.setData({groups:groupsOf(t),facts:(t.pendingFacts||[]).map((f,i)=>({...f,id:'fact-'+i,value:'',chapterText:f.chapters.join('、')})),stats:{groups:(t.elements||[]).length},ready:true,jobProgress:100});this.refresh();
  }catch(e){if(!this._unloaded)this.setData({loadError:e.message});throw e;}
  finally{if(!this._unloaded)this.setData({loading:false});}
 });},
 retry(){return this.onShow();},
 onInput(e){const d=e.currentTarget.dataset;const gi=this.data.groups.findIndex(g=>g.id===d.g),ei=this.data.groups[gi].entries.findIndex(x=>x.id===d.e),fi=this.data.groups[gi].entries[ei].fields.findIndex(f=>f.key===d.k);const base='groups['+gi+'].entries['+ei+'].fields['+fi+']';this.setData({[base+'.value']:e.detail.value,...(this.data.onlyPending?{[base+'.keepVisible']:true}:{})});this.refresh();},
 refresh(){const pendingLinks=[];const groups=this.data.groups.map(g=>{let groupCount=0,visibleCount=0;const entries=g.entries.map(e=>{let entryCount=0,visibleEntryCount=0;const fields=e.fields.map(f=>{const pending=!String(f.value||'').trim()||/待确认/.test(f.value);const anchor='field-'+g.id+'-'+e.id+'-'+f.key;if(pending){entryCount++;pendingLinks.push({anchor,label:g.name+' · '+e.elementId+' · '+f.label});}if(pending||f.keepVisible)visibleEntryCount++;return {...f,pending,anchor};});groupCount+=entryCount;visibleCount+=visibleEntryCount;return {...e,fields,pendingCount:entryCount,visiblePendingCount:visibleEntryCount};});return {...g,entries,pendingCount:groupCount,visiblePendingCount:visibleCount};});const fields=groups.flatMap(g=>g.entries.flatMap(e=>e.fields));this.setData({groups,pendingLinks,totalFields:fields.length,filledCount:fields.length-pendingLinks.length,pendingCount:pendingLinks.length});},
 togglePending(){this.setData({onlyPending:!this.data.onlyPending,groups:this.data.groups.map(g=>({...g,entries:g.entries.map(e=>({...e,fields:e.fields.map(f=>({...f,keepVisible:false}))}))}))});this.refresh();},
 locatePending(e){wx.pageScrollTo({selector:'#'+e.currentTarget.dataset.anchor,duration:250});},
 onFactInput(e){const index=this.data.facts.findIndex(f=>f.id===e.currentTarget.dataset.id);if(index>=0)this.setData({['facts['+index+'].value']:e.detail.value});},
 goFill(){wx.navigateTo({url:'/pages/fill/fill'});},
 restore(){this.onShow();},clearAll(){wx.showModal({title:'清空当前表单？',content:'尚未保存的修改将被清空。',success:r=>{if(r.confirm){this.setData({groups:this.data.groups.map(g=>({...g,entries:g.entries.map(e=>({...e,fields:e.fields.map(f=>({...f,value:''}))}))}))});this.refresh();}}});},
 save(){return api.action(this,async()=>{if(!this._elements.length)throw Error('请先生成要素表');const value=JSON.parse(JSON.stringify(this._elements));this.data.groups.forEach(g=>g.entries.forEach(e=>e.fields.forEach(f=>{const row=value.find(x=>String(x.scoreId)===String(g.scoreId))?.rows.find(r=>r.elementId===e.elementId);if(row)row[f.key]=f.value;})));
 const facts=(this.data.facts||[]).filter(f=>f.value.trim()).map(f=>({marker:f.marker,value:f.value.trim()}));
 if(facts.length){const result=await api.request(api.path()+'/pending-facts','PUT',{revision:this._revision,values:facts});this._revision=result.revision;const current=await api.refresh();this._elements=JSON.parse(JSON.stringify(current.elements||[]));const answers=new Map(facts.map(f=>[f.marker,f.value]));for(const g of value)for(const r of g.rows)for(const key of ['approach','params','owner','frequency'])r[key]=String(r[key]||'').replace(/〔待确认[:：]\s*([^〕]+)〕/g,(full,key)=>answers.get(key.trim())||full);this.setData({facts:(current.pendingFacts||[]).map((f,i)=>({...f,id:'fact-'+i,value:'',chapterText:f.chapters.join('、')}))});}
 if(JSON.stringify(value)!==JSON.stringify(this._elements)){await api.save('elements',value,this._revision);await api.stage('generate',j=>wx.showToast({title:j.label,icon:'none'}));}
 else await api.ensure('generate','sections');wx.redirectTo({url:'/pages/chapter/chapter'});});}
});
