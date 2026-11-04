'use strict';
const session = { tender: null, chapter: 0 };
let accessPrompt = null;
function accessHeaders() {
  let token = getApp().globalData.apiAccessToken;
  if (!token && typeof wx.getStorageSync === 'function') {
    const saved = wx.getStorageSync('temporaryTestAccessToken');
    if (typeof saved === 'string' && saved.length >= 32) token = saved;
  }
  return token ? { Authorization: 'Bearer ' + token } : {};
}
function askTestAccess() {
  if (!accessPrompt) accessPrompt = new Promise((resolve, reject) => wx.showModal({
    title: '输入测试访问码',
    content: '',
    editable: true, placeholderText: '粘贴管理员提供的本轮测试访问码', confirmText: '验证进入',
    success: r => r.confirm && (r.content || '').trim().length >= 32
      ? resolve(r.content.trim()) : reject(Error('尚未输入有效的测试访问码')),
    fail: () => reject(Error('无法打开访问码输入框'))
  })).finally(() => { accessPrompt = null; });
  return accessPrompt;
}
function request(path, method = 'GET', data, accessRetried = false) {
  if(getApp().globalData.cloudHosting?.enabled&&typeof wx.cloud?.callContainer==='function')return require('./cloud-transport').call(path,method,data).then(r=>{
    if(r.statusCode<300&&r.data?.ok)return r.data.data;
    throw Error(r.data?.error?.message||'云托管服务请求失败');
  });
  const base = getApp().globalData.apiBaseUrl || 'http://127.0.0.1:5310';
  return new Promise((resolve, reject) => wx.request({ url: base + path, method, data, header: accessHeaders(), timeout: 60000,
    success: async r => {
      const message = r.data?.error?.message || '服务请求失败';
      if (r.statusCode === 401 && /测试访问凭证无效/.test(message) && !accessRetried) {
        try {
          const token = await askTestAccess();
          getApp().globalData.apiAccessToken = token;
          const result = await request(path, method, data, true);
          wx.setStorageSync('temporaryTestAccessToken', token);
          resolve(result);
        } catch (e) {
          delete getApp().globalData.apiAccessToken;
          if (typeof wx.removeStorageSync === 'function') wx.removeStorageSync('temporaryTestAccessToken');
          reject(e);
        }
        return;
      }
      return r.statusCode < 300 && r.data.ok ? resolve(r.data.data) : reject(Error(message));
    },
    fail: () => reject(Error('无法连接服务，请检查服务是否启动')) }));
}
function id() { const value = session.tender?.id || wx.getStorageSync('tenderId'); if (!value) throw Error('请先新建或打开项目'); return value; }
function path() { return '/v1/tenders/' + id(); }
async function refresh(projectId) {
  const target = projectId || id();
  try {
    session.tender = await request('/v1/tenders/' + target);
  } catch (e) {
    // 项目被删除或数据被清空时，别让页面停在 404 上：清掉本地记录并给一句能看懂的提示
    if (/项目不存在/.test(e.message)) {
      session.tender = null;
      try { wx.removeStorageSync('tenderId'); } catch (_) {}
      throw Error('这个项目已不存在（数据可能已清空），请回工作台重新新建技术标');
    }
    throw e;
  }
  wx.setStorageSync('tenderId', session.tender.id);
  getApp().globalData.currentProject = session.tender;
  return session.tender;
}
async function create(name) { const t = await request('/v1/tenders', 'POST', { name }); return refresh(t.id); }
async function upload(file,onProgress=()=>{}) {
  if(getApp().globalData.cloudHosting?.enabled&&typeof wx.cloud?.callContainer==='function')return require('./cloud-transport').upload(file,path(),request,onProgress);
  onProgress({progress:0,label:'正在上传：'+file.name});
  return new Promise((resolve, reject) => {const task=wx.uploadFile({ url: (getApp().globalData.apiBaseUrl || 'http://127.0.0.1:5310') + path() + '/files', filePath: file.path, name: 'file', header: accessHeaders(),
    success: r => { try { const j = JSON.parse(r.data); if (!j.ok) throw Error(j.error.message); onProgress({progress:100,label:'已上传：'+file.name});resolve(j.data); } catch(e) { reject(e); } }, fail: () => reject(Error('上传失败，请重新选择文件')) });task?.onProgressUpdate?.(r=>onProgress({progress:r.progress,label:'正在上传：'+file.name}));});
}
async function stage(name, progress, page, options = {}) {
  const job = await request(path() + '/' + name, 'POST', options);
  while (!page || !page._unloaded) {
    const j = await request('/v1/jobs/' + job.jobId);
    if (progress) progress(j);
    if (j.status === 'failed') throw Error(j.error);
    if (j.status === 'done') return refresh();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error('页面已离开，任务继续在后台运行');
}
function stageReady(t,field){
 if(field==='blueprint')return view(t).blueprintStats.ready;
 if(field==='elements'||field==='sections')return !!t.blueprint?.length&&t.blueprint.every(bp=>{
  const group=(t[field]||[]).find(g=>String(g.scoreId)===String(bp.scoreId));
  return field==='elements'?!!group&&bp.elements.every(e=>group.rows?.some(r=>r.elementId===e.id)):!!group?.blocks?.some(b=>b.type!=='h4'&&b.text?.trim());
 });
 return Array.isArray(t[field])?t[field].length>0:!!t[field];
}
async function ensure(name, field, progress, page) { const t = await refresh();return stageReady(t,field)?t:stage(name,progress,page,['elements','sections'].includes(field)?{retryFailed:true}:{}); }
async function save(field, value, revision) { await request(path() + '/' + field, 'PUT', {revision, value}); return refresh(); }
async function check() { const c = await request(path() + '/check', 'POST', {}); session.tender.check = c; return c; }
function error(e) { wx.showModal({title:'操作未完成', content:e.message || String(e), showCancel:false}); }
async function action(page, fn) { if (page._busy) { wx.showToast({ title: '正在处理，请稍候', icon: 'none' }); return; } page._busy = true; page.setData({busy:true}); try { return await fn(); } catch(e) { if (!page._unloaded) error(e); } finally {page._busy=false; if (!page._unloaded) page.setData({busy:false});} }
function source(e) { return e ? [e.section, e.page ? 'P' + e.page : '页码未知'].filter(Boolean).join(' · ') : ''; }
function view(t) {
  const parse = t.parse || {}, p = parse.project || {}, bp = t.blueprint || [];
  const hasBody = Array.isArray(t.sections) && t.sections.length > 0;
  const scores = (parse.scores || []).map((s, i) => {
    const row = bp.find(b => b.scoreId === s.id), sec = (t.sections || []).find(s2 => s2.scoreId === s.id);
    const covered = new Set((sec?.blocks || []).filter(b => b.text.trim()).flatMap(b => b.covers));
    const elements = (row?.elements || []).map(e => ({...e, must:e.mustHave, done:covered.has(e.id), statusText:covered.has(e.id)?'已完成':hasBody?'待 AI 补写':'待 AI 生成'}));
      return {id:s.id, name:s.item, score:s.score, custom:!!s.custom,scoreText:s.custom?'自定义章节':s.score>0?s.score+' 分':'分值待重新识别', chapter:'第' + (i+1) + '章', tier:s.tierDesc, source:source(s.evidence), keywords:s.keywords, elements, depend:'mixed', depText:'需核对参数', elementsReady:!!row && elements.length>0, total:elements.length, done:elements.filter(e=>e.done).length, open:i===0, coverageLabel:!row || !elements.length?'待拆解':!hasBody?elements.length+' 条要素 · 待 AI 生成':'已完成 '+elements.filter(e=>e.done).length+'/'+elements.length};
  });
  const outline = scores.map((s,i) => ({...s, no:String(i+1), title:s.name, elDone:s.done, elTotal:s.total, locked:false, subs:s.elements.map(e=>e.name)}));
  const elements = scores.reduce((n,s)=>n+s.total,0), done=scores.reduce((n,s)=>n+s.done,0);
  const pendingItems=scores.filter(s=>!s.elementsReady).length;
  const stats = {items:scores.length,elements,done,rate:elements?Math.round(done/elements*100):0,ready:scores.length>0&&pendingItems===0,pendingItems,hasBody,rateLabel:hasBody?(elements?Math.round(done/elements*100):0)+'%':'未生成'};
  const quals = (parse.qualifications || []).map((q,i) => ({...q,id:'Q'+i,cat:({form:'形式',qual:'资格',resp:'响应性'})[q.cat],code:q.no,level:q.confidence==='low'?'mid':'high',req:q.text,src:source(q.evidence),impact:'请核对原文并在要求的位置响应',respText:({tech:'技术标内响应',attach:'需另附材料',none:'不涉及技术标'})[q.resp],respCls:({tech:'blue',attach:'orange',none:'gray'})[q.resp]}));
  const outlineMode = parse.outline?.mode || 'free';
  const fieldValue=key=>String(p[key]||'').trim()||(p.fieldStatus?.[key]==='not_specified'?'原文未明确':'尚未识别');
  const labels={purchaser:'招标人/采购人',budget:'预算/合同估算价',deadline:'投标截止',bidNo:'招标编号',evalMethod:'评标办法',pageLimit:'页数上限',blind:'技术标格式',quality:'质量要求',location:'建设地点',scope:'招标范围',duration:'工期'};
  const fieldDetails=Object.entries(labels).map(([key,label])=>({key,label,value:fieldValue(key),source:source(p.fieldEvidence?.[key]),quote:p.fieldEvidence?.[key]?.quote||'',status:p.fieldStatus?.[key]||(p[key]?'found':'unresolved')}));
  const project = {...p, name:t.nameSource==='manual'?t.name:(p.name||t.name), projectType:fieldValue('type'),quality:fieldValue('quality'),location:fieldValue('location'),scope:fieldValue('scope'),duration:fieldValue('duration'),techScore:parse.scoreSum||0,techScoreText:parse.scoreSum>0?parse.scoreSum+' 分':'待重新识别',files:t.file?[{...t.file,size:(t.file.size/1024).toFixed(1)+' KB',kind:'main',tag:'招标文件'}]:[],purchaser:fieldValue('purchaser'),budget:fieldValue('budget'),deadline:fieldValue('deadline'),daysLeft:'—',bidNo:fieldValue('bidNo'),evalMethod:fieldValue('evalMethod'),pageLimit:fieldValue('pageLimit'),blind:fieldValue('blind'),outlineMode,outlineReason:parse.outline?.reason||'大纲模式尚未识别',outlineModeText:({strict:'严格按给定大纲',guided:'参考大纲',free:'自主编制'})[outlineMode],modeEvidence:{...parse.outline?.evidence,src:source(parse.outline?.evidence),confidence:parse.outline?.confidence, page:parse.outline?.evidence?.page||'页码未知'}};
  return {project, fieldDetails, quals, qualStats:{total:quals.length,tech:quals.filter(q=>q.resp==='tech').length,attach:quals.filter(q=>q.resp==='attach').length,none:quals.filter(q=>q.resp==='none').length,cats:['形式','资格','响应性'].map(name=>({name,count:quals.filter(q=>q.cat===name).length}))},scoreItems:scores,blueprintStats:stats,sourceMode:parse.meta?.mode || '未知',outline,techRisks:quals.map(q=>({...q,impact:q.resp==='attach'?'按原文准备对应证明材料，核对资质和时效；材料缺失可能影响资格审查':q.resp==='tech'?'由 AI 在技术标相应章节编写响应，自检检查覆盖情况':'核对投标文件整体的形式或商务要求，按招标原文办理'})),scoreSplit:[{label:'技术标（抽取合计）',score:parse.scoreSum||0,bg:'#EAF1FF',color:'#165DFF',scope:'in'}],stats:{chapters:scores.length,words:((t.sections||[]).reduce((n,s)=>n+s.wordCount,0)/10000).toFixed(2),elementsDone:done,elementsTotal:elements},degraded:!!parse.meta?.degraded && Object.values(parse.meta.degraded).some(Boolean)};
}
// 与服务端写作预算一致；完成后使用实际字数。
function generationChapters(t, job) {
  return view(t).scoreItems.map((score,i) => {
    const group=(t.elements||[]).find(g=>g.scoreId===score.id);
    const section=(t.sections||[]).find(s=>s.scoreId===score.id);
    const detail=(job?.items||[]).find(item=>item.scoreId===score.id);
    const count=detail?.elementCount ?? (score.elements.length || group?.rows?.length || 0);
    const hasBody=section?.blocks?.some(b=>b.type!=='h4'&&(b.text?.trim()||b.rows?.length));
    const sheetFailure=t.elementsMeta?.failed?.find(row=>String(row.scoreId)===String(score.id)),bodyFailure=t.generateMeta?.failed?.find(row=>String(row.scoreId)===String(score.id));
    let status=hasBody?'ok':group?'prepared':'wait';
    let label=hasBody?'已完成':group?'要素表已就绪，等待生成正文':'排队中';
    let errorText=bodyFailure?.error||sheetFailure?.error||'';
    let words=detail?.wordCount ?? section?.wordCount ?? null;
    if(!hasBody&&(bodyFailure||sheetFailure)){status='error';label='生成失败，可单独重试本章';}
    if(job&&(!job.options?.scoreId||String(job.options.scoreId)===String(score.id))) {
      let state=detail?.status;
      if(!state) state=job.status==='done' || (job.step>0 && i<job.step-1)?'done':job.step>0 && i===job.step-1?(job.status==='failed'?'failed':'running'):'queued';
      status=state==='failed'?'error':state==='done'?(job.stage==='elements'?'prepared':'ok'):state==='running'?(job.stage==='elements'?'sheet':'write'):'wait';
      label=({error:'生成失败，可重试',prepared:'要素表已就绪，等待生成正文',ok:'已完成',sheet:'正在填写要素表',write:'正在生成正文',wait:job.stage==='elements'?'等待填写要素表':'排队中'})[status];
      if(state==='running'&&detail?.phaseLabel)label=detail.phaseLabel;
      if(detail?.error)errorText=detail.error;
    }
    if(status==='error'&&!hasBody)words=null;
    const plan=section?.writingPlan||require('./writing-profile').planFor(score.name,count,{project:t.parse?.project,totalElements:(t.blueprint||[]).reduce((n,g)=>n+(g.elements||[]).length,0)}),estimated=count?plan.low+'—'+plan.high:null;
    return {id:score.id,index:i+1,title:score.name,status,statusText:label,errorText,canRetry:status==='error',elementCount:count,elementLabel:count?count+' 条要素':'要素待拆解',estimatedWords:estimated,wordCount:words,wordLabel:words!==null?'实际 '+words+' 字':count?'预计 '+estimated+' 字':'字数待估算'};
  });
}

function listItem(t) {const complete=['done','exported'].includes(t.status)||(t.status==='generated'&&(!t.generation?.total||t.generation.complete));return {...t,title:t.name,shortName:t.name,coverText:t.name.slice(0,1),coverColor:'linear-gradient(135deg,#1B3A6B,#2E5C9E)',time:t.updatedAt?.slice(0,10),statusText:t.status==='generated'&&t.generation?.total&&!t.generation.complete?'部分章节未完成':({created:'待上传',uploaded:'待解析',parsed:'已解析',blueprint:'已拆解',elements:'待生成正文',generated:'正文已生成'})[t.status]||t.status,statusClass:complete?'green':'blue',tagType:complete?'green':'blue',updateText:t.updatedAt?.slice(0,10),progressColor:complete?'#00B42A':'#165DFF',progress:t.generation?.total?Math.round(t.generation.completed/t.generation.total*100):t.stages?.sections?100:0,words:0};}
async function download(draft, options = {},onProgress=()=>{}) {
  const query=Object.entries({...options,...(draft?{draft:1}:{})}).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  let result;
  onProgress({progress:0,label:'正在生成导出文件…'});
  if(getApp().globalData.cloudHosting?.enabled&&typeof wx.cloud?.callContainer==='function')result=await require('./cloud-transport').download(path(),query,request,onProgress);
  else result=await new Promise((resolve,reject) => {const task=wx.downloadFile({url:(getApp().globalData.apiBaseUrl || 'http://127.0.0.1:5310')+path()+'/export'+(query?'?'+query:''),header:accessHeaders(),success:r=>{
    if(r.statusCode!==200) return reject(Error('导出失败：请重新自检并处理阻断项，或下载测试草稿'));
    resolve({filePath:r.tempFilePath,ext:options.format==='pdf'?'pdf':'docx'});
  },fail:()=>reject(Error('下载失败'))});task?.onProgressUpdate?.(r=>onProgress({progress:Math.min(99,r.progress),label:'正在下载导出文件…'}));});
  onProgress({progress:100,label:'文件已下载，正在打开…'});
  // 微信预览器不兼容时保留已下载文件，用户仍可保存到磁盘或发送给 Word/WPS。
  const opened=await new Promise(resolve=>{try{wx.openDocument({filePath:result.filePath,fileType:result.ext,showMenu:true,success:()=>resolve(true),fail:()=>resolve(false)});}catch(_){resolve(false);}});
  return {...result,opened};
}
module.exports = { session, request, refresh, create, upload, stage, ensure, save, check, action, error, view, listItem, download, path, generationChapters,stageReady };
