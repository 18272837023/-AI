'use strict';
// 独立验证目录，绝不写用户的运行中数据库。
const fs=require('node:fs'),path=require('node:path');
process.env.DATA_DIR=path.resolve(__dirname,'../../.preview/real-workflow-data');
const llm=require('../src/lib/llm'),store=require('../src/lib/store');
const {PROMPTS,SCHEMAS}=require('../src/pipeline/units');
const {validateScores}=require('../src/pipeline/validation');
async function main(){
 const db=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/db.json'),'utf8'));
 const source=Object.values(db.tenders).find(t=>t.files.at(-1)?.name==='招标文件正文.pdf'&&t.doc?.charCount>100000);
 if(!source)throw Error('未找到已上传原件');
 const scored=await llm.runUnit({name:'真实原件评分回归',...PROMPTS.scores(source.doc.sections),schema:SCHEMAS.scores,validateData:data=>validateScores(data,source.doc.sections),maxRetries:1,fallback:async()=>{throw Error('原件评分验证失败');}});
 console.log(JSON.stringify({phase:'scores',items:scored.data.items.map(s=>({name:s.item,score:s.score,page:s.evidence.page})),sum:scored.data.items.reduce((n,s)=>n+s.score,0)}));
 const t=store.createTender({name:'真实 AI 修复验证副本'});
 const blueprint=[{scoreId:'QA1',item:'施工方案',score:7,elements:[{id:'E1',name:'施工流程',mustHave:'各阶段施工组织方法'},{id:'E2',name:'检查与整改',mustHave:'检查频次与责任岗位'}]}];
 const sections=[{scoreId:'QA1',title:'施工方案',blocks:[{type:'p',text:'施工流程为〔待确认：工作步骤数量〕。检查安排为〔待确认：检查频次〕。',covers:['E1']}]}];
 sections.forEach(require('../src/writing').recalc);
 store.updateTender(t.id,{parse:{...source.parse,scores:[{id:'QA1',item:'施工方案',score:7}],qualifications:[]},doc:source.doc,blueprint,elements:[{scoreId:'QA1',item:'施工方案',rows:blueprint[0].elements.map(e=>({elementId:e.id,name:e.name,approach:e.mustHave,params:'按本项目要求编写实施计划',owner:'项目负责人',frequency:'按实施计划检查'}))}],sections});
 const job=store.createJob(t.id,'repair',1);store.updateJob(job.id,{options:{}});
 const repair=await require('../src/writing').run(job.id,t,'repair');
 if(/〔待确认/.test(t.sections[0].plain))throw Error('AI 仍保留了写作任务占位符');
 const result={at:new Date().toISOString(),sourceId:source.id,sourceRevision:source.revision,scores:scored.data.items,scoreSum:scored.data.items.reduce((n,s)=>n+s.score,0),repair,sections:t.sections};
 fs.writeFileSync(path.resolve(__dirname,'../../.preview/real-workflow-validation.json'),JSON.stringify(result,null,2));
 store.flush();console.log(JSON.stringify({phase:'repair',words:t.sections[0].wordCount,remainingAuto:repair.remainingAuto,blocking:repair.blocking}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
