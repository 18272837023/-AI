# 标书 AI 单机测试服务端

已补充人工编辑保存、版本冲突校验、规则自检和实际 DOCX 导出。提供本机测试页面，启动后访问 http://127.0.0.1:5310/ 。双击 start-local.cmd 可启动。完整操作见 ../docs/真实招标文件测试指南.md。

不依赖数据库或 Redis，默认 mock 不调用真实模型。真实 AI 测试须配置 .env。小程序与浏览器预览已通过 `miniprogram/utils/service.js` 接入服务端；当前适合本机单用户测试。

## 快速开始

```bash
cd server
npm ci
cp .env.example .env     # 可选：默认 mock 模式不需要改
npm start                # → http://127.0.0.1:5310
```

或者用 CLI 一键跑全链（不启服务）：

```bash
node scripts/make-samples.js                              # 生成示例招标文件
node cli.js run samples/示例招标文件.docx                  # 跑完整链路并打印产出
node cli.js run samples/示例招标文件.docx --json out.json   # 结果写入 JSON
```

## 架构

```
server/
├── src/
│   ├── index.js              # 启动入口
│   ├── config.js             # 配置（环境变量 → config 对象）
│   ├── api.js                # HTTP 路由定义
│   ├── parse.js              # M01 文档归一化 + M02 章节树
│   ├── lib/
│   │   ├── http.js           # 极简 HTTP：路由、JSON、multipart
│   │   ├── store.js          # 持久化：JSON 文件 + 防抖落盘
│   │   ├── queue.js          # 单机任务队列（并发可配）
│   │   ├── llm.js            # 模型调用 + Schema 校验 + 降级
│   │   └── util.js           # id、日志、原子写等工具
│   ├── pipeline/
│   │   ├── run.js            # 四阶段编排（parse → blueprint → elements → generate）
│   │   ├── units.js          # 6 个能力单元的 Schema + Prompt
│   │   └── baseline.js       # 规则基线（mock 模式 + live 兜底）
│   └── rules/
│       ├── lexicon.js        # 词表：暗标词、空话词、规范号白名单
│       └── check.js          # M17—M20 自检（纯规则）
├── scripts/make-samples.js   # 生成示例招标文件
├── cli.js                    # 命令行跑全链
├── samples/                  # 示例文件
├── data/                     # 运行时数据（gitignore）
└── .env.example
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/health` | 健康检查 |
| POST | `/v1/tenders` | 新建项目 `{ name }` |
| GET | `/v1/tenders` | 项目列表 |
| GET | `/v1/tenders/:id` | 项目详情（含解析/施工图/要素/正文/自检全量数据） |
| GET | `/v1/tenders/:id?slim=1` | 项目摘要（只有状态） |
| POST | `/v1/tenders/:id/files` | 上传招标文件（raw body + `x-filename` header，或 multipart） |
| POST | `/v1/tenders/:id/parse` | 解析（6 步：M01→M02→M04→M05→M06→M07） |
| POST | `/v1/tenders/:id/blueprint` | 施工图（M09） |
| POST | `/v1/tenders/:id/elements` | 要素表（M13） |
| POST | `/v1/tenders/:id/generate` | 正文（M14，跑完自动自检） |
| POST | `/v1/tenders/:id/check` | 自检（M17—M20，同步纯规则） |
| GET | `/v1/jobs/:jobId` | 轮询任务进度 |
| GET | `/v1/tenders/:id/jobs` | 项目下所有任务 |

### 调用顺序

```
建项目 → 上传文件 → parse → 轮询 job 直到 done
                     → blueprint → 轮询 job 直到 done
                     → elements → 轮询 job 直到 done
                     → generate → 轮询 job 直到 done（自动自检）
                     → check（可选，同步返回）
```

`parse / blueprint / elements / generate` 都是异步的：接口立刻返回 `jobId`，真正的活在队列里跑，前端轮询 `GET /v1/jobs/:jobId` 直到 `status === 'done'`。原因是小程序 `wx.request` 超时 60 秒，而一份技术标要跑几分钟。

## 模型模式

| 模式 | 说明 |
|------|------|
| `mock`（默认） | 不调模型，走规则基线。链路可跑、可回归，但抽取质量不高 |
| `live` | 调 OpenAI 兼容接口（DeepSeek / 通义 / vLLM）。需要 `.env` 填 `LLM_API_KEY` |

切换：改 `.env` 里的 `LLM_MODE=live` + `LLM_API_KEY=sk-xxx`。

live 模式下，模型输出必须通过 JSON Schema 与内容校验才被采纳。关键抽取与正文生成失败会明确报错或保留部分成功结果，供用户重试，不应把规则模拟结果当成真实模型成功。具体重试与降级行为以各能力单元配置为准。

## 为什么不引 express / dotenv

HTTP 路由与 JSON、multipart 处理集中在 `src/lib/http.js`。环境变量由 `src/config.js` 读取；已有进程环境变量优先于 `.env`。

## 持久化

P0 的持久化是"一个 JSON 文件 + 防抖落盘"：
- 单机、单进程、数据量小（一份招标文件文本 ~200KB）
- 原子写：先写 `.tmp` 再 rename，避免进程被杀时留下半个 JSON
- 重启后 running 的 job 自动标成 failed

换成 Postgres / 云数据库时，保持 `store.js` 的方法签名不变，上层不用改。

## 已知边界

| 边界 | 说明 |
|------|------|
| DOCX 无页码 | Word 不存分页信息，`page = null`。只有 PDF 有精确页码 |
| 不做 OCR | 扫描版 PDF 抽不到文本会报错，提示用文字版 |
| 规则基线不是生产质量 | 它只能证明契约是通的，抽得准不准要靠 live 模式验证 |
| 任务不持久 | 队列在内存里，进程挂了任务丢失（store 标成 failed） |

## 回归测试与结果一致性

运行 `npm test`。测试使用独立临时目录，不读取现有项目数据，不调用真实模型。
覆盖 HTTP 全链、非法请求、Schema 基线校验、任务互斥、最新文件选择和上游重跑清理。

同项目同阶段重复请求复用原任务；其他阶段及上传在任务执行时返回 409。
重新上传以最新文件作为解析源，保留文件历史，并清除全部旧产物。
重新执行上游阶段会立即清除该阶段及下游结果，失败后需要重试该阶段。
支持 DOCX、文字版 PDF 和 TXT，不支持旧版二进制 DOC，后者请先转换。测试前会自动生成合成示例文件，不需要上传自己的招标文件。


## 待补字段与完整要素表

主流程“待补字段”恢复为项目真实信息问卷，和完整要素表编辑分离。GET/PUT `/v1/tenders/:id/supplements` 读取/保存问卷；POST `/v1/tenders/:id/supplements/training-draft` 拟定需用户确认的培训计划。用户值独立持久化，保存只替换对应占位符或更新对应补充段落，不调用全量生成。手工精修过的关联段落遇到冲突会保留并返回提醒。

## AI 解析字段与原文依据

项目要素抽取覆盖招标人、预算/合同估算价、投标截止时间、招标编号、地点、范围、工期、质量、承包模式、行业、评标办法、页数和明暗标格式。按字段挑选带相邻段落的原文，避免 PDF 表格标题和值被拆开后遗漏。非空字段需提供能在对应页定位的原文依据；有明确原文的核心字段漏抽会重试，不以空白或规则基线假装真实模型完成。

合格性读取公告资格条件与完整评审表，检查工期、质量、承包人建议等技术响应是否遗漏。页签徽标显示条款总数，另列技术标内响应、需另附材料与其他要求的数量。风险页列出需核对的原文要求，不把没有技术响应条款误显示成没有任何风险。

前端使用抽取的真实字段，`fieldStatus` 区分 `found`、`not_specified` 与 `unresolved`，未知项不会被固定的占位文案覆盖。大纲模式显示原文判据与页码。
# 2026-11-02 解析与清单支持

- 招标正文仍使用 PDF / DOCX / TXT；通过“上传附件”添加工程量清单 XLSX / XLS。
- Excel 保留工作表名称、行号、单位和工程量，并参与方案上下文；不执行宏或计算公式，公式采用文件内保存的结果。请先在 Excel 中重新计算并保存。
- 每个 Excel 文件最多 100 张工作表，每表 20000 行、256 列，总计 500000 个单元格、200 万字符；附件文本总量超过 80 万字符时明确提示拆分，不再静默忽略附件。
- 评分读取保留 Word 单元格边界和 PDF 行列位置，支持“评审标准”章节与跨页续表。规则恢复结果仍须通过正分值及技术总分校验，不以虚构分值跳过失败。
- 解析失败后保留已完成单元；同一原文重试从失败单元继续，更新附件后自动作废旧断点。
