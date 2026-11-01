const api = require('../../utils/service.js');
Page({data:{tab:0,stats:{},items:[],sheet:{rows:[]},needCount:0,sheets:[],hasElements:false,busy:false},
 onShow(){api.action(this,async()=>{const t=await api.refresh();const v=api.view(t);this.setData({stats:v.blueprintStats,items:v.scoreItems,hasElements:!!t.elements?.length,sheets:(t.elements||[]).map(g=>({...g,rows:g.rows.map(r=>({el:r.elementId,name:r.name,point:r.approach,params:[r.params],owner:r.owner,freq:r.frequency,conf:r.confidence,needUser:/待确认/.test(r.params)}))}))});});},
 switchTab(e){this.setData({tab:Number(e.currentTarget.dataset.i)});},toggle(e){const i=this.data.items.findIndex(s=>s.id===e.currentTarget.dataset.id);if(i>=0)this.setData({['items['+i+'].open']:!this.data.items[i].open});},
 regenerate(){wx.showModal({title:'重新拆解？',content:'会清除已保存的要素表和正文。',success:r=>{if(r.confirm)api.action(this,async()=>{const t=await api.stage('blueprint');const v=api.view(t);this.setData({stats:v.blueprintStats,items:v.scoreItems,hasElements:!!t.elements?.length,sheets:[]});});}});},
 confirm(){if(this.data.items.some(i=>!(i.score>0))){wx.navigateTo({url:'/pages/analysis/analysis'});return;}wx.navigateTo({url:'/pages/outline/outline'});},editElements(){if(this._busy)return;wx.navigateTo({url:'/pages/elements/elements'});}
});
