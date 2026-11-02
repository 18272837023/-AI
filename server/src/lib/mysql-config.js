'use strict';

function mysqlOptions(env=process.env){
 const fields=['MYSQL_ADDRESS','MYSQL_USERNAME','MYSQL_PASSWORD','MYSQL_DATABASE'];
 const missing=fields.filter(key=>typeof env[key]!=='string'||!env[key].trim());
 if(missing.length)throw Error('MySQL 缺少环境变量：'+missing.join('、')+'。请在“服务设置 → 环境变量”补齐，变量名不要带引号、反引号或空格；保存后重新执行流水线发布。');
 const address=env.MYSQL_ADDRESS.trim();
 const match=/^([a-zA-Z0-9_.-]+)(?:\s*:\s*(\d+))?$/.exec(address);
 const port=Number(match?.[2]||env.MYSQL_PORT||3306);
 if(!match||!Number.isInteger(port)||port<1||port>65535)throw Error('MYSQL_ADDRESS 格式无效，应为主机地址或 主机地址:端口（例如 10.40.107.83:3306），不要填写协议、引号或反引号');
 return {host:match[1],port,user:env.MYSQL_USERNAME.trim(),password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE.trim(),charset:'utf8mb4',connectionLimit:8,connectTimeout:15000};
}
module.exports={mysqlOptions};
