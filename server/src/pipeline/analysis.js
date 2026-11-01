'use strict';
const textOf=s=>[s.no,s.title,s.text].filter(Boolean).join('\n');
const compact=s=>String(s||'').replace(/\s/g,'');
const PROJECT_FIELDS={name:'项目名称',purchaser:'招标人/采购人',budget:'预算或合同估算价',deadline:'投标截止时间',bidNo:'招标编号',location:'建设地点',scope:'招标范围',duration:'工期',quality:'质量要求',type:'承包模式',sector:'项目行业',evalMethod:'评标办法',pageLimit:'技术标页数上限',blind:'技术标格式'};
const PROJECT_NEEDLES=[/项目名称|工程名称|标段名称/,/招标人|采购人|项目业主/,/合同估算价|项目预算|采购预算|最高投标限价|最高限价/,/投标.{0,8}截止|递交.{0,8}截止/,/招标编号|项目编号/,/建设地点|项目地点/,/招标范围|建设规模/,/计划工期|总工期/,/质量标准|质量要求|质量目标/,/评标办法|评标方法|评定分离/,/页数|页数上限|不超过\d+页|暗标|明标|匿名评审|技术标格式/];
function selectWindows(sections,needles,maxHits=3,radius=1){
 const chosen=new Set();
 for(const re of needles){const hits=sections.map((s,i)=>({i,text:compact(textOf(s)),s})).filter(x=>re.test(x.text));
  // 同一字段优先公告、须知前附表和直接以字段名命名的小节，而非后面的空白合同格式。
  hits.sort((a,b)=>(a.s.page||a.i)-(b.s.page||b.i));
  for(const {i} of hits.slice(0,maxHits))for(let j=Math.max(0,i-radius);j<=Math.min(sections.length-1,i+radius);j++)chosen.add(j);
 }
 return [...chosen].sort((a,b)=>a-b).map(i=>sections[i]);
}
function render(sections,max=65000){
 let used=0;const out=[];
 for(const s of sections){const chunk=`【${s.no||''} ${s.title||''}｜${s.page?'P'+s.page:'页码未知'}】\n${s.text||''}`;if(used+chunk.length>max){out.push(chunk.slice(0,Math.max(0,max-used)));break;}out.push(chunk);used+=chunk.length;}
 return out.join('\n\n');
}
function projectContext(sections){return render(selectWindows(sections,PROJECT_NEEDLES,4,1),55000);}
function qualificationContext(sections){
 const evalRows=require('./validation').scoringSections(sections);
 const front=selectWindows(sections,[/投标人资格|投标人须具备|本标段招标要求|资格要求/,/资格评审|形式评审|响应性评审/,/质量标准|工期|承包人建议符合|投标内容符合/,/不予受理|否决投标|投标将被否决|无效投标/],4,1);
 const merged=new Set([...evalRows,...front]);
 return render(sections.filter(s=>merged.has(s)),68000);
}
function outlineContext(sections){
 const candidates=selectWindows(sections,[/投标文件格式|技术标格式|技术文件组成/,/承包人建议书|承包人实施计划|承包人实施方案/,/章节内容|给定的格式|施工组织设计|附表一|技术标目录/],12,2);
 return render(candidates,65000);
}
function quoteExists(e,sections){if(!e?.quote?.trim())return false;const quote=compact(e.quote);return sections.some(s=>(e.page==null||s.page===e.page)&&compact(textOf(s)).includes(quote));}
function validateProject(p,sections){
 const corpus=compact(sections.map(textOf).join('\n'));
 const mandatory={purchaser:/(?:招标人为|招标人[：:]|采购人[：:]|招标人名称[：:])[\u4e00-\u9fff]{2}/,budget:/合同估算价[：:]\d|项目预算[：:]\d/,deadline:/投标文件递交截止时间为[：:]\d{4}|投标截止时间\d{4}/,bidNo:/招标编号[：:][A-Za-z\d]/,location:/建设地点[：:]?[\u4e00-\u9fff]{2}/,quality:/质量(?:标准|要求|目标)[：:](?:合格|优良|达到|满足|符合|设计|施工|国家|工程)/};
 for(const [key,re]of Object.entries(mandatory))if(re.test(corpus)&&!p[key]?.trim())return `原文中有${PROJECT_FIELDS[key]}，不能漏抽；请读取相邻小节、标题中的字段值`;
 for(const key of Object.keys(PROJECT_FIELDS))if(p[key]?.trim()&&!quoteExists(p.fieldEvidence?.[key],sections))return `${PROJECT_FIELDS[key]}缺少可定位的原文证据，必须在 fieldEvidence.${key} 引用所在页的连续原文，不能拼接或臆造`;
 return null;
}
function finishProject(p,sections){
 const statuses={};for(const key of Object.keys(PROJECT_FIELDS)){p[key]=typeof p[key]==='string'?p[key].trim():'';statuses[key]=p[key]?'found':'not_specified';}
 p.fieldStatus=statuses;return p;
}
function validateQualifications(data,sections){
 const all=compact(sections.map(textOf).join('\n'));
 for(const [label,re]of [['工期',/工期符合第二章/],['质量',/质量标准符合第二章/],['承包人建议',/承包人建议符合第五章/]])if(re.test(all)&&!data.items?.some(q=>q.resp==='tech'&&q.text.includes(label)))return `响应性评审表有${label}要求，必须抽出为技术标内响应条款，不能只抽资质证书`;
 return null;
}
module.exports={PROJECT_FIELDS,projectContext,qualificationContext,outlineContext,validateProject,validateQualifications,finishProject,quoteExists};
