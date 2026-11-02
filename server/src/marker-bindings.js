'use strict';
const MARKER=/〔待确认[:：]\s*([^〕]+)〕/g;
const bindings=[
 ['F1','name',/类似.{0,8}(?:项目名称|工程名称)|业绩.{0,6}名称/],
 ['F1','type',/(?:类似|同类|业绩|项目经历).{0,8}(?:项目类型|工程类型)|类似项目类型/],
 ['F1','signDate',/合同.{0,6}(?:签订|签约).{0,4}(?:时间|日期)|签约日期/],
 ['F1','amount',/(?:合同|业绩|类似项目).{0,6}金额/],
 ['F1','status',/(?:类似项目|业绩|项目经历).{0,6}(?:实施|完成|竣工|履约)(?:情况|状态|时间)?/],
 ['F2','peak',/高峰人数|人数峰值|现场.{0,6}人数|作业人数/],
 ['F2','vendor',/供应商.{0,6}(?:进场|入场|到场)|(?:项目经理|技术负责人|安全员|特种作业|管理人员|施工人员).{0,4}(?:进场|入场|到场)时间/],
 ['F2','source',/人员来源|劳动力来源/],
 ['F3','subject',/培训.{0,6}(?:对象|人员范围)/],
 ['F3','freq',/(?:培训|教育培训).{0,8}(?:频次|学时|时长)/],
 ['F3','content',/培训.{0,4}(?:内容|课程)/],
 ['F3','check',/(?:培训|教育).{0,8}(?:考核方式|考核方法)/],
 ['F3','fail',/(?:培训|考核).{0,8}不合格.{0,4}(?:处置|处理)/]
];
function bindingFor(marker){
 if(/^(?:类似项目(?:业绩|经历)?|同类项目经验|项目经历补充|企业类似业绩)$/.test(String(marker).trim()))return {groupId:'F1',key:'name',groupValue:true};
 const hit=bindings.find(([, ,re])=>re.test(String(marker)));return hit?{groupId:hit[0],key:hit[1]}:null;
}
function textOfBlock(block){return [block.text,...(block.rows||[]).map(row=>row.join(' | '))].filter(Boolean).join('\n');}
function answersOf(groups){
 const answers=[];
 for(const g of groups)for(const field of g.fields||g.entries[0]?.fields||[]){
  const values=g.entries.map(e=>e.fields.find(f=>f.key===field.key)?.value?.trim()).filter(Boolean);
  const value=g.declared?'未提供（已人工确认）':values.length>1?values.map((v,i)=>`第${i+1}条：${v}`).join('；'):values[0];
  for(const binding of field.markers||[]){
   const groupValue=g.entries.map(e=>e.fields.filter(f=>f.value?.trim()).map(f=>`${f.label}：${f.value.trim()}`).join('，')).filter(Boolean).join('；');
   const resolved=binding.groupValue&&!g.declared?groupValue:value;
   if(resolved)answers.push({...binding,value:resolved});
  }
 }
 return answers;
}
function replace(text,scoreId,answers){return String(text||'').replace(new RegExp(MARKER.source,'g'),(full,key)=>answers.find(a=>a.marker===key.trim()&&a.targets.some(t=>String(t.scoreId)===String(scoreId)))?.value||full);}
module.exports={MARKER,bindingFor,textOfBlock,answersOf,replace};
