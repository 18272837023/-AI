'use strict';
const textOf=s=>[s.no,s.title,s.text].filter(Boolean).join('\n');
const compact=s=>String(s||'').replace(/\s/g,'');
// 目录里的点引线和页码不是项目事实，长目录不能挤掉公告和须知正文。
function withoutContents(text){return String(text||'').split(/\r?\n/).filter(line=>!/[.．·…]{3,}\s*\d+\s*$/.test(line)&&!/^\s*目\s*录\s*$/.test(line)).join('\n');}
function physicalSources(pages){
 const rows=pages.map(p=>{const lines=String(p.text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);return {page:p.page,lines,counter:/^\d{1,4}$/.test(lines.at(-1)||'')?Number(lines.at(-1)):null};});
 return rows.map((row,i)=>{const adjacent=j=>rows[j]&&rows[j].page-row.page===j-i&&row.counter!=null&&rows[j].counter!=null&&rows[j].counter-row.counter===j-i;const lines=row.lines.slice();if(lines.length>1&&(adjacent(i-1)||adjacent(i+1)))lines.pop();return {page:row.page,text:lines.join('\n')};});
}
const PROJECT_FIELDS={name:'项目名称',purchaser:'招标人/采购人',budget:'预算或合同估算价',deadline:'投标截止时间',bidNo:'招标编号',location:'建设地点',scope:'招标范围',duration:'工期',quality:'质量要求',type:'承包模式',sector:'项目行业',evalMethod:'评标办法',pageLimit:'技术标页数上限',blind:'技术标格式'};
const PROJECT_NEEDLES=[/项目名称|工程名称|标段名称/,/招标人|采购人|项目业主/,/合同估算价|项目预算|采购预算|最高投标限价|最高限价/,/投标.{0,8}截止|递交.{0,8}截止/,/招标编号|项目编号/,/建设地点|项目地点/,/招标范围|建设规模/,/计划工期|总工期/,/质量标准|质量要求|质量目标/,/评标办法|评标方法|评定分离/,/页数|页数上限|不超过\d+页|暗标|明标|匿名评审|技术标格式/];
function selectWindows(sections,needles,maxHits=3,radius=1){
 const chosen=new Set();
 for(const re of needles){const hits=sections.map((s,i)=>({i,text:compact(withoutContents(textOf(s))),s})).filter(x=>re.test(x.text));
  // 同一字段优先公告、须知前附表和直接以字段名命名的小节，而非后面的空白合同格式。
  hits.sort((a,b)=>(a.s.page||a.i)-(b.s.page||b.i));
  for(const {i} of hits.slice(0,maxHits))for(let j=Math.max(0,i-radius);j<=Math.min(sections.length-1,i+radius);j++)chosen.add(j);
 }
 return [...chosen].sort((a,b)=>a-b).map(i=>sections[i]);
}
function render(sections,max=65000){
 let used=0;const out=[];
 for(const s of sections){const chunk=`【${s.no||''} ${s.title||''}｜${s.page?'P'+s.page:'页码未知'}】\n${withoutContents(s.text)}`;if(used+chunk.length>max){out.push(chunk.slice(0,Math.max(0,max-used)));break;}out.push(chunk);used+=chunk.length;}
 return out.join('\n\n');
}
function projectSources(sections,pages){return Array.isArray(pages)&&pages.length&&pages.some(p=>p.page!=null)?physicalSources(pages).map(p=>({no:'',title:'PDF正文',page:p.page,text:withoutContents(p.text)})):sections.map(s=>({...s,text:withoutContents(s.text)}));}
function projectContext(sections,pages){return render(selectWindows(projectSources(sections,pages),PROJECT_NEEDLES,4,1),55000);}
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
function evidenceSources(sections,pages){
 if(!Array.isArray(pages)||!pages.length||!pages.some(p=>p.page!=null))return sections.map(s=>({page:s.page,text:textOf(s)}));
 const sources=physicalSources(pages),joined=[];
 for(let i=0;i<sources.length-1;i++){const a=sources[i],b=sources[i+1];if(b.page===a.page+1)joined.push({page:a.page,endPage:b.page,text:a.text+'\n'+b.text,boundary:a.text.length});}
 return [...sources,...joined];
}
function quoteMatches(quote,sources,table=false){
 const target=compact(quote);if(!target)return [];
 const matches=[];
 for(const source of sources){
  const skip=table?[...source.text.matchAll(/(?:^|\n)\s*\d+(?:\.\d+){1,4}\s*\|\s*[^|\n]{1,30}\s*\|\s*/g)].map(m=>[m.index,m.index+m[0].length]):[];
  let normalized='',map=[],range=0;
  for(let i=0;i<source.text.length;i++){while(range<skip.length&&i>=skip[range][1])range++;if(range<skip.length&&i>=skip[range][0])continue;const c=source.text[i];if(!/\s/.test(c)){normalized+=c;map.push(i);}}
  const index=normalized.indexOf(target);if(index<0)continue;
  const start=map[index],end=map[index+target.length-1]+1;
  if(source.boundary!=null&&!(start<source.boundary&&end>source.boundary))continue;
  const actual=source.text.slice(start,end);
  if(table&&compact(actual).length-target.length>200)continue;
  matches.push({page:source.page,...(source.endPage?{endPage:source.endPage}:{}),quote:actual});
 }
 return matches;
}
function quoteExists(e,sections,pages){return !!e?.quote?.trim()&&quoteMatches(e.quote,evidenceSources(sections,pages)).some(s=>e.page==null||s.page===e.page);}
function normalizeProject(p,sections,pages){
 const sources=evidenceSources(sections,pages);
 for(const e of Object.values(p.fieldEvidence||{})){
  if(!e?.quote?.trim())continue;
  const exact=quoteMatches(e.quote,sources),hits=exact.length?exact:quoteMatches(e.quote,sources,true);
  const hit=hits.find(h=>h.page===e.page)||(hits.length===1?hits[0]:null);
  // 只定位逐字一致的内容；表格跳列引用恢复成包含条款号的真实连续原文。
  if(hit){e.page=hit.page;e.quote=hit.quote;if(hit.endPage)e.endPage=hit.endPage;else delete e.endPage;}
 }
 return p;
}
function validateProject(p,sections,pages){
 const corpus=compact(projectSources(sections,pages).map(textOf).join('\n'));
 const mandatory={purchaser:/(?:招标人为|招标人[：:]|采购人[：:]|招标人名称[：:])[\u4e00-\u9fff]{2}/,budget:/合同估算价[：:]\d|项目预算[：:]\d/,deadline:/投标文件递交截止时间为[：:]\d{4}|投标截止时间\d{4}/,bidNo:/招标编号[：:][A-Za-z\d]/,location:/建设地点[：:]?[\u4e00-\u9fff]{2}/,quality:/质量(?:标准|要求|目标)[：:](?:合格|优良|达到|满足|符合|设计|施工|国家|工程)/};
 for(const [key,re]of Object.entries(mandatory))if(re.test(corpus)&&!p[key]?.trim())return `原文中有${PROJECT_FIELDS[key]}，不能漏抽；请读取相邻小节、标题中的字段值`;
 for(const key of Object.keys(PROJECT_FIELDS))if(p[key]?.trim()&&!quoteExists(p.fieldEvidence?.[key],sections,pages))return `${PROJECT_FIELDS[key]}缺少可定位的原文证据，必须在 fieldEvidence.${key} 引用所在页的连续原文，不能拼接或臆造`;
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
module.exports={PROJECT_FIELDS,projectContext,qualificationContext,outlineContext,validateProject,validateQualifications,finishProject,quoteExists,normalizeProject};
