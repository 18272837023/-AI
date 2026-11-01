'use strict';
const config = require('../src/config');
async function main() {
 const base = config.llm.baseUrl.replace(/\/$/, '');
 if (new URL(base).hostname !== 'api.deepseek.com') throw Error('该检查仅用于 DeepSeek 官方地址');
 const headers = {authorization:'Bearer '+config.llm.apiKey, 'content-type':'application/json'};
 const models = await fetch(base+'/models',{headers,signal:AbortSignal.timeout(30000)});
 let listed=[];
 if(models.ok){const body=await models.json();listed=(body.data||[]).map(m=>({id:m.id,name:m.name||null}));}
 const r = await fetch(base+'/chat/completions',{method:'POST',headers,signal:AbortSignal.timeout(45000),body:JSON.stringify({model:config.llm.model,messages:[{role:'user',content:'Return only the word OK.'}],max_tokens:32})});
 const body=await r.json();
 console.log(JSON.stringify({configuredModel:config.llm.model,mode:config.llm.mode,modelListStatus:models.status,availableModels:listed,status:r.status,success:r.ok,responseModel:body.model||null,hasText:!!body.choices?.[0]?.message?.content,usage:body.usage?{total_tokens:body.usage.total_tokens}:null,errorCode:body.error?.code||null},null,2));
 if(!r.ok)process.exitCode=1;
}
main().catch(()=>{console.log('连接检查未完成（网络或超时），未输出密钥');process.exitCode=1;});
