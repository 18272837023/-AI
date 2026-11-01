'use strict';
// 评分表的相邻小节必须一起读取，不能只按关键词命中独立碎片。
function scoringSections(sections) {
 const start=sections.findIndex(s=>/^第.+章$/.test(s.no||'')&&/^评标办法/.test(s.title||''));
 if(start<0)return sections;
 let end=sections.findIndex((s,i)=>i>start&&/^第.+章$/.test(s.no||'')&&s.no!==sections[start].no);
 if(end<0)end=sections.length;
 return sections.slice(start,end);
}
function validateScores(data, sections=[]) {
 const rows=data.items||[];
 if(!rows.length||rows.some(s=>!Number.isFinite(s.score)||s.score<=0||s.score>100||!s.tierDesc?.trim()))return '必须抽取评分表中的实际子项、正分值和评分标准，不能将评分计算说明当成0分子项';
 if(new Set(rows.map(s=>s.id)).size!==rows.length)return '评分项 ID 重复';
 if(rows.reduce((n,s)=>n+s.score,0)>100)return '技术评分合计超过100，可能重复计算父项与子项';
 const text=scoringSections(sections).map(s=>s.no+s.title+s.text).join('').replace(/\s/g,'');
 const design=/承包人建议书[：:]([\d.]+)分/.exec(text),plan=/承包人实施方案[：:]([\d.]+)分/.exec(text);
 const technical=/技术(?:标|部分|方案)(?:评分)?(?:总分|满分)?[（(:：]?([\d.]+)分/.exec(text);
 const expected=design&&plan?Number(design[1])+Number(plan[1]):technical?Number(technical[1]):null;
 if(expected&&Math.abs(rows.reduce((n,s)=>n+s.score,0)-expected)>.01)return `技术评分子项合计必须为${expected}分。资信业绩部分中的类似项目业绩、人员资格配备以及报价不得计入技术方案评分，不能遗漏技术子项`;
 return null;
}

/**
 * 语义校验：拦两类问题
 * 1. 把 AI 该写的写作任务（段落数、频次、措施内容）推给用户 → 必须重写
 * 2. 整章大比例留占位符 → 视为推卸，要求补齐（真正需要用户的事实除外）
 */
function validateGroup(data, source, field) {
 if(data.items?.length!==1||data.items[0].scoreId!==source.scoreId)return '本次只能返回当前评分项，不能新增、重复或混入其他章节';
 const row=data.items[0],ids=(source.elements||source.rows||[]).map(e=>e.id||e.elementId);
 const {needsUser,isWritingTask,isPlanHedge}=require('../facts');
 const texts=field==='rows'?(row.rows||[]).map(r=>[r.approach,r.params,r.owner,r.frequency].join('\n')):(row.blocks||[]).map(b=>b.type==='table'?[b.text,...(b.rows||[]).map(r=>r.join(' | '))].join('\n'):b.text);

 // 1. 明确的写作任务不得留占位符（计划类内容同样归 AI 写实）
 const writingTasks=[];
 for(const t of texts){
   const re=new RegExp(require('../facts').MARKER.source,'g');
   let m;
   while((m=re.exec(t))){
     if(isPlanHedge(m[1])||isWritingTask(m[1])&&!needsUser(m[1]))writingTasks.push(m[1]);
   }
 }
 if(writingTasks.length)return '以下属于 AI 应完成的方案编写，必须直接写成拟采取的做法、频次或岗位，不能交给用户待填：'+writingTasks.slice(0,3).join('、');

 // 2. 整章推卸检查：大量要素留着"非用户事实"类占位符，说明没真写方案
 if(field==='rows'&&row.rows?.length){
   const lazy=row.rows.filter(r=>{
     const re=new RegExp(require('../facts').MARKER.source,'g');
     let m;
     while((m=re.exec([r.approach,r.params,r.owner,r.frequency].join('\n')))){
       if(!needsUser(m[1])||isPlanHedge(m[1]))return true;
     }
     return false;
   }).length;
   if(lazy/row.rows.length>0.6)return '本章超过六成要素留了可自行编写的占位符，请依据招标文件和项目信息把做法、频次与岗位写实，只保留确实无法代替用户确认的事实';
 }

 if(field==='rows') {
  const got=(row.rows||[]).map(r=>r.elementId);
  if(got.length!==ids.length||new Set(got).size!==got.length||got.some(id=>!ids.includes(id)))return '要素表必须逐条完整回应本评分项的要素';
 } else {
  const content=b=>b.type==='p'&&b.text.trim()||b.type==='table'&&b.rows?.slice(1).some(r=>r.some(c=>String(c).trim()));
  if(!row.blocks?.some(content))return '章节正文为空';
  if(row.blocks.some(b=>b.covers.some(id=>!ids.includes(id))))return '正文关联了本评分项不存在的要素';
  if(ids.some(id=>!row.blocks.some(b=>content(b)&&b.covers.includes(id))))return '必须由 AI 写全本章要素，不能将缺写内容交给用户';
 }
 return null;
}
module.exports={scoringSections,validateScores,validateGroup};
