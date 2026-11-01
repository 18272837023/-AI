const api = require('../../utils/service.js');
let uid = 0;
const nextUid = () => 'f' + (++uid);
const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
Page({
 data:{types:['EPC 总承包','施工类','服务咨询','货物类'],activeType:0,scopes:[{key:'all',name:'技术标章节',desc:'依据本次招标文件评分项生成',rec:true}],activeScope:'all',files:[],hasMain:false,projectName:'',busy:false,nameStatus:''},
 pickType(e){this.setData({activeType:Number(e.currentTarget.dataset.index)});}, pickScope(e){this.setData({activeScope:e.currentTarget.dataset.key});},
 onNameInput(e){this._manualName=!!e.detail.value.trim();this.setData({projectName:e.detail.value,nameStatus:this._manualName?'使用手动填写的名称':''});},
 chooseFile(){if(this._busy)return;wx.chooseMessageFile({count:1,type:'file',extension:['pdf','docx','txt'],success:r=>this.prepareFile(r.tempFiles[0]),fail:()=>{}});},
 prepareFile(file){return api.action(this,async()=>{
  const selection=this._selection=(this._selection||0)+1;this._draftId=null;
  this.setData({files:[{...file,uid:nextUid(),size:fmtSize(file.size),kind:'main',tag:'招标文件正文'}],hasMain:true,nameStatus:'正在上传并识别项目名称…',...(!this._manualName?{projectName:''}:{})});
  const t=await api.create('');await api.upload(file);
  if(selection!==this._selection)return;this._draftId=t.id;
  try {const result=await api.request(api.path()+'/identify-name','POST',{});if(selection!==this._selection)return;
   if(!this._manualName)this.setData({projectName:result.name||'',nameStatus:result.name?'已从招标文件识别，可手动修改':'暂未识别到名称，可手动填写或在完整解析后确认'});
   else this.setData({nameStatus:'已保留手动填写的名称'});
  }catch(e){if(selection===this._selection)this.setData({nameStatus:'名称预识别未完成，可手动填写或继续解析'});}
 });},
 // 附件先留在本地，点「开始解析」时随正文一起上传，误点删除不会在服务端留下孤儿文件。
 chooseAttach(){
  if(this._busy)return;
  wx.chooseMessageFile({count:5,type:'file',extension:['pdf','docx','txt'],success:r=>{
   const add=r.tempFiles.map(f=>({...f,uid:nextUid(),size:fmtSize(f.size),kind:'attach',tag:'附件'}));
   this.setData({files:this.data.files.concat(add)});
  },fail:()=>{}});
 },
 removeFile(e){
  const i=Number(e.currentTarget.dataset.index),f=this.data.files[i];
  if(!f)return;
  if(f.kind==='main'){
   this._selection=(this._selection||0)+1;this._draftId=null;
   this.setData({files:[],hasMain:false,nameStatus:'',...(!this._manualName?{projectName:''}:{})});
   return;
  }
  this.setData({files:this.data.files.filter((_,n)=>n!==i)});
 },
 startParse(){return api.action(this,async()=>{
  if(!this.data.files.length)throw Error('请先选择招标文件');
  if(this._draftId)await api.refresh(this._draftId);else {const t=await api.create('');await api.upload(this.data.files[0]);this._draftId=t.id;}
  const attachments=this.data.files.filter(f=>f.kind==='attach');
  if(attachments.length){this.setData({nameStatus:'正在上传附件…'});for(const f of attachments)await api.upload(f);}
  if(this._manualName&&this.data.projectName.trim())await api.request(api.path()+'/name','PUT',{name:this.data.projectName.trim(),revision:api.session.tender.revision});
  wx.navigateTo({url:'/pages/parsing/parsing'});
 });}
});
