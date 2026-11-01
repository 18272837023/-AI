const api = require('../../utils/service.js');
const steps = ['读取并归一化文档','构建章节树','抽取项目要素','审查合格性条款','抽取技术标评分','判定大纲约束'];
Page({
 data:{percent:0,projectName:'',steps:steps.map(text=>({text,status:'wait'})),error:''},
 onLoad(){
  this._unloaded=false;this._shown=0;this._target=0;this._done=false;this._redirected=false;
  // 服务端只在阶段切换时上报进度（0/16/33…），直接显示会一段一段地跳。
  // 这里每 70ms 向目标值缓动逼近；未完成时再缓慢向上爬一点，看起来是连续转动的。
  this._timer=setInterval(()=>this.tick(),70);
  this.start();
 },
 onUnload(){this._unloaded=true;if(this._timer){clearInterval(this._timer);this._timer=null;}},
 tick(){
  if(this._unloaded)return;
  const cap=this._done?100:Math.min(99,this._target+12);
  if(this._shown<cap){
   const gap=cap-this._shown;
   this._shown=Math.min(cap,this._shown+Math.max(0.4,gap*0.12));
   const p=Math.round(this._shown);
   if(p!==this.data.percent)this.setData({percent:p});
   return;
  }
  if(this._done&&!this._redirected){
   this._redirected=true;
   if(this._timer){clearInterval(this._timer);this._timer=null;}
   wx.redirectTo({url:'/pages/analysis/analysis'});
  }
 },
 start(){api.action(this,async()=>{
  const t=await api.refresh();this.setData({projectName:t.name,error:''});
  try{
   await api.ensure('parse','parse',j=>{this._target=Math.max(this._target,j.progress||0);this.setData({steps:steps.map((text,i)=>({text,status:i<j.step-1?'done':i===j.step-1?'now':'wait'}))});},this);
   if(!this._unloaded){this._done=true;this._target=100;this.setData({steps:steps.map(text=>({text,status:'done'}))});}
  }catch(e){this.setData({error:e.message});throw e;}
 });}
});
