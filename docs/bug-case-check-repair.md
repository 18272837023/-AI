# 自检页「未找到需要修改的章节」Bug Case

## 一、现象

在「自检」页面，用户点击「AI 一键优化」后，弹出错误弹窗：

- 标题：**操作未完成**
- 内容：**未找到需要修改的章节**

截图中自检状态：
- 阻断：1 项（要素覆盖）
- 警告：1 项（合规核验）
- 通过：4 项

阻断项内容：「项目施工实施要点」还有 4/4 条要素没写，AI 将按该评分项的要求补写遗漏要素。

---

## 二、根因分析

### 调用链路

```
用户点击 "AI 一键优化"（check.js:29 / check.wxml）
  → check.js optimize() 调用 api.stage('repair', ...)
    → service.js stage() POST /v1/tenders/:id/repair { issueId: 'C2' }
      → 服务端执行 repair
        → 根据 issueId 查找对应自检项
        → 根据自检项的 fixPage 和 loc 定位章节
        → ❌ 定位失败 → 抛出错误 "未找到需要修改的章节"
          → 错误被 service.js action() 捕获
            → service.js error() 弹窗："操作未完成 / 未找到需要修改的章节"
```

### 为什么定位失败？

服务端 `repair` 接口的逻辑：
1. 拿到 `issueId`（如 `'C2'`）
2. 查自检项的 `fixPage` 字段（`'chapter'` 表示要去章节页修改）
3. 根据 `loc`（如 `'第六章 6.3'`）定位具体章节
4. **在这里失败** — 章节 ID 映射断裂或章节尚未生成

可能的具体原因：

| 原因 | 说明 |
|---|---|
| **章节尚未生成** | 自检时章节还没写完，repair 去改一个不存在的内容 |
| **章节 ID 映射断裂** | `loc: '第六章 6.3'` 字符串无法映射到实际章节数据 ID |
| **服务端 repair 未完整实现** | 当前 MVP 中 repair 接口可能是占位逻辑 |
| **mock 数据缺失** | `mock.js` 中没有 `repair` 的 mock 实现，测试环境直接透传服务端 |

### 重要：当前是真实数据

截图中的阻断项是「项目施工实施要点」还有 4/4 条要素没写，这与 `mock.js` 中 `selfCheck.items` 的 C2（E5 偏差处置）不一致。说明用户使用的是**真实解析流程**产生的数据，不是测试 mock 数据。这确认是**服务端真实逻辑**的问题。

---

## 三、当前代码位置

### 前端

- `miniprogram/pages/check/check.js` — 自检页逻辑
  - `optimize(issueId)` — 一键优化入口（第 33-71 行）
  - `fixAllAuto()` — 调用 `optimize()` 不带 issueId（第 85 行）
  - `primary(e)` — 点击单个项的修复按钮（第 26-29 行）
  
- `miniprogram/pages/check/check.wxml` — 自检页模板
  - 顶部结果卡片显示 `blocking` 计数
  - 每项显示 `fixLabel`（"AI 一键优化" / "去填写" / "查看并修改"）
  - 底部导出按钮 `disabled="{{check.blocking > 0}}"`

- `miniprogram/utils/service.js` — API 封装
  - `stage(name, progress, page, options)` — 发起 repair 请求（第 33-41 行）
  - `action(page, fn)` — 统一错误处理，失败时弹窗（第 48 行）
  - `error(e)` — 弹窗"操作未完成"（第 47 行）

### mock 数据

- `miniprogram/utils/mock.js`
  - `selfCheck` — 自检项定义（第 629 行起）
  - `buildCheck()` — 组装自检结果（第 772 行起）
  - `gateOf()` — 导出页门禁文案（第 820 行起）
  - **注意：`module.exports` 中没有导出 repair 相关方法，mock 层完全不拦截 repair 请求**

### 自检数据字段说明

```js
selfCheck.items 中每项包含：
- id: 问题编号（C1, C2, C3...）
- cat: 类别（qual/cover/compliance/placeholder/style/supplement/source）
- level: 级别（block/warn/pass）
- fixType: 修复方式（auto / manual）
- fixPage: 跳转页面（chapter / fill / analysis）
- loc: 位置描述（如"第六章 6.3"）
```

---

## 四、优化建议

### 4.1 前端层面（立即可做）

#### a) 修复失败时给更清晰的引导

当前弹窗只有一句"未找到需要修改的章节"，用户不知道该干嘛。建议按阻断类型分情况提示：

| 阻断类型 | 引导文案 |
|---|---|
| 要素覆盖（cover） | "AI 未能自动定位到对应章节，请进入【章节编辑】手动补写要素" |
| 占位符（placeholder） | "有内容需要您填写真实信息，请进入【待补字段】完成填写" |
| 合格性覆盖（qual） | "合格性条款响应不完整，请进入【章节编辑】补充响应内容" |
| 服务端错误 | "AI 优化服务暂时不可用，请手动修改后重新自检" |

实现位置：`service.js error()` 或 `check.js optimize()` 的 catch 块。

#### b) 增加「手动忽略阻断」功能

在每条阻断项卡片上增加"忽略此项"按钮：

1. **交互**：点击后弹出二次确认「确认忽略？此项将不再阻塞导出，但可能影响评分」
2. **状态**：将该阻断项从 `blocking` 列表移到 `ignored` 列表
3. **计数**：`blocking` 计数减 1，但保留该条目显示（带"已忽略"标签）
4. **导出**：导出页显示警告"有 X 项阻断被忽略，可能影响评分"
5. **记录**：在 `checkState` 或 `session` 中记录被忽略的项，支持「恢复」

实现位置：
- `check.js` 新增 `ignoreIssue(id)` 方法
- `check.wxml` 阻断项卡片增加忽略按钮
- `mock.js` `buildCheck()` 中处理 `ignored` 状态
- `export.js` 导出页读取忽略项并显示警告

#### c) 导出按钮状态优化

当前导出按钮 `disabled="{{check.blocking > 0}}"`，阻断 > 0 时完全不能点。建议：
- 阻断 > 0 且没有可自动修复项时：按钮可点击但显示「强制导出（有 X 项阻断）」
- 点击后二次确认："还有阻断项未处理，确定要导出吗？"

### 4.2 服务端层面

#### a) 完善 repair 的章节定位逻辑

- 确保 `loc` 字段能正确映射到章节数据
- 如果章节不存在，先创建占位章节再写入
- 返回更详细的错误信息（如"第六章 6.3 不存在"而不是笼统的"未找到"）

#### b) 区分「可修复」和「需人工处理」

"要素覆盖"类问题不一定都能自动修复。如果 AI 无法生成合理的要素内容：
- 返回 `fixType: 'manual'` 而不是报错
- 前端自动将该项的修复按钮改为"去手动修改"

### 4.3 mock 数据层面

`mock.js` 中目前完全没有 `repair` 的 mock 实现。建议加一个简化版：

```js
// 在 mock.js 中增加
function repair(issueId) {
  return new Promise((resolve) => {
    setTimeout(() => {
      // 模拟修复成功
      if (issueId) {
        checkState.resolved[issueId] = true;
      } else {
        // 一键修复所有 auto 项
        selfCheck.items.forEach(it => {
          if (it.fixType === 'auto') checkState.resolved[it.id] = true;
        });
      }
      resolve({ ok: true });
    }, 2000 + Math.random() * 2000);
  });
}
```

并在 `service.js` 的 `stage()` 中（或 mock 路由层）拦截 `repair` 请求，走 mock 逻辑而不是打到服务端。

---

## 五、需要 Codex 做的具体事项

请按以下优先级处理：

1. **【P0】前端：修复失败弹窗优化**
   - 修改 `service.js error()` 或 `check.js optimize()` catch 块
   - 按阻断类型给出不同引导文案
   - 不要只显示"未找到需要修改的章节"

2. **【P0】前端：增加"手动忽略阻断"功能**
   - `check.js` 新增 `ignoreIssue()` 方法
   - `check.wxml` 阻断项卡片增加忽略按钮 + 二次确认
   - `mock.js` `buildCheck()` 处理 `ignored` 状态
   - `export.js` 导出页显示忽略警告

3. **【P1】mock：增加 repair 的 mock 实现**
   - 让测试环境下 repair 能正常工作（模拟修复成功）
   - 支持单条修复和一键修复

4. **【P2】前端：导出按钮增加"强制导出"模式**
   - 阻断 > 0 时按钮可点击，文案改为"强制导出（有 X 项阻断）"
   - 点击后二次确认

5. **【服务端】由后端团队处理**
   - 完善 repair 接口的章节定位逻辑
   - 区分可自动修复和需人工处理的情况
   - 返回更详细的错误信息

---

## 六、相关代码文件清单

| 文件 | 说明 |
|---|---|
| `miniprogram/pages/check/check.js` | 自检页逻辑 |
| `miniprogram/pages/check/check.wxml` | 自检页模板 |
| `miniprogram/pages/check/check.wxss` | 自检页样式 |
| `miniprogram/pages/export/export.js` | 导出页逻辑 |
| `miniprogram/pages/export/export.wxml` | 导出页模板 |
| `miniprogram/utils/service.js` | API 封装 + 错误处理 |
| `miniprogram/utils/mock.js` | mock 数据 + buildCheck + gateOf |

---

## 七、截图说明

截图文件路径：`C:\Users\PC\.workbuddy-ai\clipboard-images\clipboard-2026-11-01T04-03-22-064Z-78ba2f6c.png`

截图内容：
- 页面标题：「AI 技术标」→ 流程进度条显示第 3 步「生成技术标」
- 顶部卡片：还有 1 项阻断，暂不可导出（阻断 1 / 警告 1 / 通过 4）
- 中间弹窗：操作未完成 / 未找到需要修改的章节 / 确定
- 弹窗下方可见阻断项：「项目施工实施要点」还有 4/4 条要素没写 — 阻断
- 警告项：合规核验 — 8 处可能涉及身份的词
- 底部按钮：重新自检 / 阻断项未清零（disabled）

---

## 八、2026-11-01 Codex 实际走查与代码修复

### 核实的根因

当前真实项目的施工图有 11 个评分项，要素表也有 11 组，但正文只有 10 章，缺少 `scoreId = "10"` 的「项目施工实施要点」。真实阻断 ID 是 `C2-10`。

实际服务端按 `scoreId` 关联施工图和正文，没有使用本文前面推测的 `fixPage/loc` 来定位修复。故障来自：M14 允许单章失败后保留其余章节，而 repair 只遍历已有的 `sections`，未将施工图中缺失的章节加入修复计划。前端又用“存在任意章节”判断生成完成，导致部分成功也自动进入后续流程。

### 已完成的机制修复

- 自检条目附带 `scoreId`、缺失要素 ID、缺章状态和位置文案；修复按稳定 ID 定位，不依赖章号或标题展示。
- repair 根据施工图建立缺失章节的修复任务；如果同时缺少该章要素表，先补齐要素表，再生成正文。只有校验成功才保存，不留空章。
- 新章按施工图顺序插入；已有章节和人工修改保留。某章失败后继续其他章节，部分成功如实提交，失败项仍由自检阻断；全部失败则保留原正文与版本。
- 生成页面按全部评分项判断完成，部分失败不显示“生成完成”、不自动进入待补字段。重试只补失败项，保留完成内容；项目列表显示实际完成比例。
- 自检失败提示包含对应章节、保留原文说明及重试方法；剩余 AI 问题不会被描述成“只能用户补真实资料”。
- 维持真实自检与正式导出门禁。本文前面的忽略阻断、强制导出及前端模拟修复是原建议，不是本次修复的实现方式。

### 验证范围

采用独立临时数据和模拟模型验证缺失中间章、全部正文为空、缺要素表、补写失败回滚、部分成功、定向生成重试、前端完成状态和错误提示。当前用户项目未触发补写或重新生成。

### 后续格式兼容修正（同日）

用户自行重试后，新的失败日志已不再是定位不到章节，而是模型输出的表格超过 12 行、部分块遗漏 covers、将段落嵌套在 rows 中，导致 Schema 校验拒绝整章。

现增加校验前的结构整理：长表格拆成不丢数据的续表；只在标题已明确关联要素时向下继承关联；明确的嵌套正文展开成扁平块。无法确定的结构仍报错，不猜填内容或把未知要素判为已覆盖。表格中的写作占位符继续参与校验。用户现有项目不自动执行补写，保留测试进度供自行重试。
