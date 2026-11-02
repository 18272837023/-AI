'use strict';
const cloud=require('./lib/cloud-state');
function user(req){
 const appid=req.headers['x-wx-appid'],openid=req.headers['x-wx-openid'];
 if(appid!==process.env.WECHAT_APPID||typeof openid!=='string'||!openid)throw Object.assign(Error('请从已关联的小程序访问服务'),{statusCode:401});
 return appid+':'+openid;
}
// 必须在控制台关闭公网入口，身份头仅信任微信私有调用链路。
async function handle(route,args,handler){
 if(!cloud.enabled()||route.path==='/v1/health')return handler(args);
 const owner=user(args.req);
 const write=args.req.method!=='GET'||route.path.endsWith('/export');
 let status,headers,body;
 const response={writeHead(code,h){status=code;headers=h;},end(data){body=data;}};
 await cloud.run(write,()=>handler({...args,res:response}),{owner});
 args.res.writeHead(status||200,headers||{});args.res.end(body);
}
module.exports={handle,user};
