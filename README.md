# AI 标书

微信原生小程序与 Node.js 服务端，用于技术标的解析、编写、人工编辑、自检和文件导出。浏览器预览直接加载同一套小程序源码，统一入口为 `http://127.0.0.1:5310/`。

## 当前功能

- 上传 DOCX、文字版 PDF、TXT，识别项目名称并回填，抽取项目要素、合格性条款、技术评分和大纲要求。
- 将评分项拆成必答要素与要素表，再按章节生成正文，显示逐章进度、字数与失败重试状态。
- 保留原产品流程中的三项待补信息：项目经历、供应商进场时间、培训计划。项目经历支持增加条目，培训支持 AI 拆解与手工新增。
- 人工编辑与保存章节，校验版本冲突；支持 AI 优化、自检问题定位、缺章补写及保留已有正文的重试。
- 导出前执行规则自检，区分阻断、警告和通过；支持实际 Word（DOCX）与 PDF 导出、排版设置和测试草稿。

本项目聚焦技术标，不编制商务报价、保证金材料或资格证明。生成内容仍需结合招标原文与真实项目资料审核。

## 本机启动

安装 Node.js 22 LTS（最低 18）及 npm，下载或克隆本仓库：

```powershell
git clone https://github.com/18272837023/-AI.git
cd ./-AI/server
npm ci
npm start
```

浏览器打开 `http://127.0.0.1:5310/`。保持服务窗口运行；关闭窗口后本地地址将无法访问。Windows 安装好依赖后，也可以双击 `server/start-local.cmd` 启动。

默认使用 `mock` 规则模拟模式，可以验证流程，不代表真实 AI 生成质量。从工作台新建项目并上传文件开始测试。

### 配置真实 AI

在 `server` 目录复制配置模板：

```powershell
Copy-Item .env.example .env
```

编辑本机 `server/.env`：

```dotenv
LLM_MODE=live
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=填写你自己的密钥
LLM_MODEL=deepseek-chat
```

模型名称需要与 API 提供方实际支持的接口名称一致。修改后重启服务。真实 AI 调用会消耗所配置账户的额度。

`.env`、上传原件、生成文稿、日志与本机测试数据均不提交到 GitHub；下载仓库后需要自行配置密钥和上传文件。

### 微信开发者工具

导入仓库根目录，源码目录由 `project.config.json` 指向 `miniprogram/`。配置自己的 AppID，并根据运行环境修改 `miniprogram/app.js` 中的 `apiBaseUrl`。本机开发地址为 `http://127.0.0.1:5310`。

微信真机需要能从手机访问的 HTTPS 服务地址及对应合法域名配置。手机上的 `127.0.0.1` 指向手机本身，不能访问电脑上的服务。浏览器预览用于本机验证，最终小程序效果需在开发者工具和真机确认。

## 项目结构

```text
miniprogram/              微信原生页面、组件、样式和接口适配
  utils/service.js        服务端接口与前端数据映射
  utils/mock.js           演示数据与历史交互设计
server/
  src/api.js              HTTP 接口
  src/pipeline/           解析、拆解、要素表与正文生成
  src/lib/                存储、任务队列、模型调用和路由
  src/rules/              确定性规则自检
  test/                   隔离数据的自动化回归测试
  scripts/make-samples.js 合成示例文件生成器
  .env.example            可提交的配置模板
tools/preview/            同一套小程序源码的浏览器预览器
docs/                     产品设计、测试指南与修复记录
```

运行数据默认写入 `server/data/`，使用本地 JSON 持久化与文件存储。`npm ci` 根据已提交的锁文件安装依赖，无需提交 `node_modules`。

## 验证

在 `server` 目录运行：

```powershell
npm test
```

测试前自动生成合成示例，测试使用独立临时目录和模拟模式，不调用真实模型、不改动已有项目数据。覆盖上传与解析链路、人工保存与冲突、生成重试、待补信息、自检修复及实际导出。

也可使用命令行验证全链路：

```powershell
npm run sample
node cli.js run samples/示例招标文件.docx
```

PDF 导出及相关测试需要中文字体。Windows 默认使用系统中的宋体、黑体和仿宋；Linux 支持配置 Fandol 同类字体或自定义字体路径，见 [Ubuntu 部署配置](deploy/README.md)。DOCX 导出不依赖服务端安装这些字体。

## GitHub 与在线运行

该仓库托管完整源代码，GitHub Pages 无法运行此 Node.js 服务端。在线使用需要另行部署持续运行的 Node.js 进程、HTTPS 入口和持久化数据目录，并配置服务器环境变量。

当前版本面向本机单用户试用，尚无登录鉴权和多用户数据隔离，不支持扫描 PDF 的 OCR。任务队列运行于单个进程，重启后未完成任务会标为失败。公开上线前需补齐这些能力；不要直接把当前测试服务暴露到公网。

操作说明见 [真实招标文件测试指南](docs/真实招标文件测试指南.md)，接口与存储说明见 [服务端 README](server/README.md)，预览说明见 [预览器 README](tools/preview/README.md)。`docs` 中的早期产品方案保留为设计参考，当前运行方式以本 README 和源码为准。
