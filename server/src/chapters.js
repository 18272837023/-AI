'use strict';
const store=require('./lib/store');
const checks=require('./rules/check');
const {id}=require('./lib/util');
function bad(message,statusCode=400){throw Object.assign(Error(message),{statusCode});}
function change(t,body){
 if(!body||typeof body!=='object'||Array.isArray(body))bad('无效的章节操作');
 if(body.revision!==(t.revision||0))bad('项目已变化，请刷新大纲后重试',409);
 if(!t.parse?.scores?.length)bad('请先完成招标文件解析');
 const action=body.action;
 if(!['add','rename','remove','move'].includes(action))bad('无效的章节操作');
 const next=JSON.parse(JSON.stringify({parse:t.parse,blueprint:t.blueprint,elements:t.elements,sections:t.sections}));
 const scores=next.parse.scores,index=scores.findIndex(s=>String(s.id)===String(body.scoreId));
 if(action!=='add'&&index<0)bad('章节不存在',404);
 const title=typeof body.title==='string'?body.title.trim():'';
 if(['add','rename'].includes(action)&&(!title||title.length>120))bad('章节标题应为1—120字');
 const history={at:new Date().toISOString(),action,scoreId:body.scoreId||null};
 if(action==='add'){
  if(scores.length>=80)bad('章节数量已达80章，请先整理现有大纲');
  const scoreId=id('manual');history.scoreId=scoreId;
  const score={id:scoreId,item:title,score:0,tierDesc:String(body.requirements||'按本项目要求编写本章的具体实施方案').slice(0,4000),keywords:[title],confidence:'low',custom:true,evidence:{section:'用户新增章节',page:null,quote:''}};
  scores.push(score);
  if(next.blueprint)next.blueprint.push({scoreId,item:title,score:0,tierDesc:score.tierDesc,keywords:[title],custom:true,elements:[{id:'E1',name:'本章目标与响应要求',mustHave:'结合项目范围说明本章目标与响应内容'},{id:'E2',name:'实施步骤与措施',mustHave:'写明实施步骤、控制措施和检查方法'},{id:'E3',name:'责任与实施安排',mustHave:'写明责任岗位、实施时点与异常处置'}]});
 }else if(action==='rename'){
  history.beforeTitle=scores[index].item;scores[index].item=title;
  for(const row of next.blueprint||[])if(String(row.scoreId)===String(body.scoreId))row.item=title;
  for(const row of next.elements||[])if(String(row.scoreId)===String(body.scoreId))row.item=title;
  for(const row of next.sections||[])if(String(row.scoreId)===String(body.scoreId))row.title=title;
 }else if(action==='remove'){
  if(scores.length===1)bad('请至少保留一章；可以先新增正确章节，再删除误识别章节');
  history.removed={score:scores[index],blueprint:next.blueprint?.find(g=>String(g.scoreId)===String(body.scoreId)),elements:next.elements?.find(g=>String(g.scoreId)===String(body.scoreId)),section:next.sections?.find(g=>String(g.scoreId)===String(body.scoreId))};
  next.parse.excludedScores=[...(next.parse.excludedScores||[]),{...scores[index],reason:'用户从本次技术标中排除',at:history.at}];
  scores.splice(index,1);
  for(const key of ['blueprint','elements','sections'])if(next[key])next[key]=next[key].filter(g=>String(g.scoreId)!==String(body.scoreId));
 }else{
  if(!Number.isInteger(body.index)||body.index<0||body.index>=scores.length)bad('无效的章节位置');
  const [row]=scores.splice(index,1);scores.splice(body.index,0,row);
 }
 const order=new Map(scores.map((s,i)=>[String(s.id),i]));
 for(const key of ['blueprint','elements','sections'])if(next[key])next[key].sort((a,b)=>order.get(String(a.scoreId))-order.get(String(b.scoreId)));
 next.parse.scoreSum=scores.reduce((n,s)=>n+(Number(s.score)||0),0);next.parse.meta={...next.parse.meta,outlineEdited:true};
 const patch={...next,chapterHistory:[...(t.chapterHistory||[]),history].slice(-20)};
 for(const key of ['elementsMeta','generateMeta'])if(t[key]?.failed)patch[key]={...t[key],failed:t[key].failed.filter(row=>order.has(String(row.scoreId)))};
 patch.check=next.sections?.length?checks.checkAll({...t,...patch}):null;
 store.updateTender(t.id,patch);store.flush();
 return {revision:t.revision,chapters:scores.length,scoreId:history.scoreId};
}
module.exports={change};
