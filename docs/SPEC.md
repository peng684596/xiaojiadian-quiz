# 小型家用电器制造工理论题库刷题站 · 开发规格

纯静态站点，**零构建**（原生 HTML/CSS/ES Modules），直接部署到 GitHub Pages 仓库根目录即可运行。
不要引入 npm 依赖、打包器、框架。不要写 TypeScript。

站点标题：`小型家用电器制造工题库`
副标题：`2024 全国工业设计职业技能大赛 · 小型家用电器制造工决赛理论题库`

---

## 1. 数据契约（唯一权威，不可改）

运行时只加载 `data/questions.json`（同目录，相对路径）。用 `fetch('data/questions.json')` 加载。

```json
{
  "meta": {
    "title": "2024 全国工业设计职业技能大赛 小型家用电器制造工 决赛理论题库",
    "shortTitle": "小型家用电器制造工题库",
    "version": "2024-appliance-r1",
    "total": 2240,
    "activeTotal": 2149
  },
  "chapters": [
    { "id": "c1", "name": "职业道德与职业素养", "order": 1, "count": 60, "total": 60 }
  ],
  "questions": [
    {
      "id": "s0001",
      "no": 1,
      "page": 2,
      "type": "single",
      "typeLabel": "单选题",
      "chapter": "c1",
      "stem": "工业设计的基本原则不包括（　　）。",
      "options": [
        { "key": "A", "text": "实用性" },
        { "key": "B", "text": "美观性" },
        { "key": "C", "text": "经济性" },
        { "key": "D", "text": "随意性" }
      ],
      "answer": ["D"],
      "explain": "",
      "flags": [],
      "sourceNo": 1,
      "unnumbered": false,
      "dupOf": null
    }
  ]
}
```

字段约定：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定唯一。题型前缀 + 4 位题号：单选 `s0001`、多选 `m0001`、判断 `j0001`；原 PDF 漏印题号的题在末尾加 `a`（如 `s1186a`） |
| `no` | number | 站内题号。等于 PDF 题号；漏印题号的题借用前一道的题号 |
| `sourceNo` | number \| null | PDF 里印的原始题号，`null` 表示原页没印题号 |
| `page` | number | PDF 页码（用于溯源） |
| `type` | `"single" \| "multi" \| "judge"` | 单选 / 多选 / 判断 |
| `typeLabel` | string | 题型中文名，可直接展示 |
| `chapter` | string | 章节 id，必须存在于顶层 `chapters[].id`；未分类兜底用最后一个正课章节 |
| `stem` | string | 题干。题干里可能残留 `（　　）` 占位括弧，原样显示即可 |
| `options` | array | `single`/`multi` 为 2–4 项，`judge` 固定为 `[{"key":"T","text":"正确"},{"key":"F","text":"错误"}]` |
| `answer` | string[] | 正确答案 key 数组。`single`/`judge` 长度为 1；`multi` 长度 ≥ 2 |
| `explain` | string | 解析。原题库没有解析，本数据集全为空字符串 |
| `images` | array（可选） | 题干配图：`[{ "src": "assets/fig/fig-1113.png", "alt": "…", "w": 425, "h": 260 }]`，`src` 相对站点根 |
| `flags` | string[] | 数据标记，见下表。空数组 = 正常题 |
| `dupOf` | `null` \| string | 重复题的保留题 `id`。这类题前端**默认不抽取**，可由「包含重复题」设置开启 |
| `unnumbered` | boolean | 原 PDF 未印题号（仅 1 条） |

`flags` 取值与前端处理：

| 标记 | 前端 flag | 含义 | 是否可练 |
|---|---|---|---|
| `broken` | `broken` | 题干/选项无法还原（选项为空、缺答案） | **永不抽取，不给开关** |
| `image-missing` | （随 `broken`） | 原题依赖图片但图未找回 | 随 broken 处理 |
| `answer-key-missing` | `review` | 原 PDF 该处没给答案 | 可练，标记为待复核 |
| `no-answer` | `review` | 同上，缺答案 | 可练，标记为待复核 |
| `single-multi-answer` | `review` | 单选印了多个答案 | 可练，标记为待复核 |
| `multi-single-answer` | `review` | 多选只印了一个答案 | 可练，标记为待复核 |
| `type-mismatch` | `review` | 题型判断可能有误 | 可练，标记为待复核 |
| `dup-option-fixed` | `review` | 选项重复，构建时已去重 | 可练，标记为待复核 |
| `figure` | `figure` | 含题干配图 | 可练，展示配图 |

前端 `normalizeFlag()` 同时兼容 `flags: []`（本项目格式）与 `flag: "review"`（旧格式）。
`chapters[]` 元素带 `count`（该章节可练题数，不含重复题与 broken 题）与 `total`（含重复题）。
`meta.activeTotal` = 可练题数；`meta.total` = 数组总长度（含重复题）。

`chapters` 当前为 `c1`…`c14` 十四个正课章节，没有兜底章。
章节**可能为空**（某章 0 题）——UI 必须能容忍，显示「暂无题目」而不是崩。

### 判分规则（硬要求）

- `single` / `judge`：所选 key 集合与 `answer` 集合完全相等 → 对，否则错。
- `multi`：**全对才给分**。只要漏选或多选一律判错，没有任何部分分。
- 单选题若用户只选了一项，直接判定；多选题必须点「提交答案」才判定（因为要多选）。

### 选项乱序规则

- 只对 `single`/`multi` 生效，`judge` 永远不乱序。
- 乱序必须是**确定性**的：同一道题在同一次作答中反复渲染（比如回看）顺序不变；换下一题才可能换顺序。用 `seed = hash(question.id + shuffleSalt)` 做洗牌，不要用 `Math.random()` 直接洗。
- 乱序后显示字母 A/B/C/D 仍按位置从 A 开始重新编号，但判分必须映射回原始 `key`。
- 每个会话随机生成一次 `shuffleSalt`（sessionStorage 存，避免刷新后同题顺序突变）。

---

## 2. 功能需求（九块，全部要实现）

路由用 hash：`#/`、`#/chapters` 等。无后端。

### 2.1 首页 `#/`

仪表盘：
- 大标题 + 副标题
- 四个数字卡：可练题数、已练题数（去重）、今日待复习、错题本数量
- 快捷入口按钮：开始练习、模拟考试、今日复习、错题本
- 章节进度条（已练/总数 + 正确率），点击进章节练习
- 连续打卡天数（当天有任一答题记录算打卡）

### 2.2 章节练习 `#/chapters` + `#/practice`

- `#/chapters`：卡片列表，每张卡显示章节名、题数、已练数、正确率、进度条；点击 → `#/practice?chapter=c1`
- `#/practice` 支持 query 参数：`chapter=<id>`、`scope=all|wrong|favorite|review`、`ids=a,b,c`、`shuffle=1`
- 练习流程：一次一题。单选/判断点击选项立即判定并显示对错与正确答案；多选勾选后点「提交」判定。
- 判定后显示：✓/✗ 反馈条、正确答案（多选显示 "ABC"）、"下一题"按钮（可设置自动下一题，1.2s 后跳）。
- 顶部进度：`第 n / N 题` + 进度条 + 退出按钮（退出回来源页）。
- 提供「上一个」回看已答题（只读，不重复计分）。
- 会话结束后显示小结：答对数/总数、正确率、用时、错题列表（可一键重练错题）。
- 每题可点「★ 收藏」；判定错误自动进错题本。
- 带 `images` 的题在题干下方展示配图（`figure` + `figcaption`）。

### 2.3 模拟考试 `#/exam`

- 设置页：范围（全部 / 指定章节多选）、题量（20 / 50 / 100 / 全部）、时长（30 / 60 / 90 / 120 分钟）、是否选项乱序。
- 题型配比：按范围内实际题型比例抽取，保证单选、多选、判断都有（若某题型数量不足则不限）。
- 考试中：倒计时（剩余 mm:ss，最后 60s 变红）；答题卡面板（题号网格，已答/未答/标记不同颜色，点击跳转）；可标记「不确定」；可提前交卷（二次确认）。
- 时间到自动交卷。
- 交卷后成绩页：得分（每题 1 分）、正确率、用时、按题型拆分正确率、逐题回顾（你的答案 vs 正确答案）。考试成绩存本地历史（最多 20 条），首页/统计页可看。

### 2.4 错题本 `#/wrong`

- 列表：题干摘要、类型、错误次数、最近错误时间、章节
- 操作：开始重练（`#/practice?scope=wrong`）、单题「已掌握」移出、清空
- 支持按章节/题型筛选
- 重练答对不自动移出（由用户手动标"已掌握"），但显示「连续答对 2 次」提示

### 2.5 收藏 `#/favorites`

- 列表 + 开始重练（`#/practice?scope=favorite`）+ 取消收藏

### 2.6 记忆曲线 `#/review`

- 简化版间隔重复（SM-2 lite）：
  - 每个题目状态 `{ level: 0..5, due: 'YYYY-MM-DD', lastSeen: ISO, reps, lapses }`
  - 间隔表：`[1, 2, 4, 7, 15, 30]` 天
  - 答对：`level = min(level+1, 5)`，`due = 今天 + 间隔[level]`
  - 答错：`level = 0`，`due = 今天`
  - 新题（未学过）不进复习队列，只在练习/考试中出现
- 页面：今日待复习数量（到期且 due <= 今天）、按 level 分组的数量（0–5 六档，条形）、「开始今日复习」按钮 → `#/practice?scope=review`
- 复习顺序：先 level 低的，再按 due 升序。

### 2.7 统计 `#/stats` + 设置 `#/settings`

统计：
- 累计答题数、累计正确率、连续打卡、最长连续打卡
- 近 14 天答题量柱状图（纯 CSS，不引库）
- 各章节正确率横向条形图
- 考试历史列表（时间、得分、用时）

设置：
- 选项乱序（默认开）
- 答题后自动下一题（默认关）
- 深色/浅色主题（默认跟随系统，可手动固定）
- 数据导出（下载 JSON）/ 导入（选文件恢复）/ 清空所有数据（二次确认）
- 显示"包含重复题"开关（默认关）
- 显示版本号

---

## 3. 本地存储

前缀统一 `appq:`。键：

- `appq:progress` → `{ [questionId]: { seen, correct, wrong, lastSeen, level, due, reps, lapses } }`
- `appq:wrong` → `{ [questionId]: { count, lastWrongAt, streak } }`
- `appq:favorites` → `string[]`
- `appq:settings` → `{ shuffle, autoNext, theme, includeDup }`
- `appq:stats` → `{ daily: { 'YYYY-MM-DD': { answered, correct } }, examHistory: [] }`
- `appq:session` → sessionStorage，乱序 salt + 未完成的考试状态（刷新可恢复考试）

所有写入要 try/catch 兜底（隐私模式 / 配额满）。

---

## 4. 文件布局（严格按此，不要新建别的 js 文件）

```
index.html
404.html             # Pages 404 兜底，回到仓库根
css/style.css
js/app.js            # 入口：加载数据、hash 路由、全局壳（顶栏/底栏）
js/store.js          # localStorage 读写、默认值、导出导入、迁移
js/srs.js            # 记忆曲线调度
js/quiz.js           # 出题队列、选项乱序、判分、flag 文案
js/ui.js             # DOM 辅助函数（h()、toast、modal、进度条、题干配图）
js/views/home.js
js/views/practice.js
js/views/chapters.js
js/views/exam.js
js/views/wrong.js
js/views/favorites.js
js/views/review.js
js/views/stats.js
js/views/settings.js
data/questions.json  # 运行时唯一数据源
data/meta.json       # meta + chapters 摘要（调试用，运行时不必加载）
assets/fig/*.png     # 题干配图（7 张）
tools/parse.py       # 构建期：PDF → raw.json
tools/build.py       # 构建期：raw.json → data/questions.json
```

`index.html` 用 `<script type="module" src="js/app.js"></script>`。

---

## 5. 样式与体验要求

- 移动端优先，桌面居中最大宽度 860px。
- 中文正文字体栈：`system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`。
- 用 CSS 变量做主题，`[data-theme="dark"]` 覆盖。
- 选项按钮要有明显的选中/正确/错误三态（正确绿边、错误红边、漏选的多选正确答案用虚绿边提示）。
- 所有按钮有 `:active` 反馈，禁用态有样式。
- 无障碍：选项用 `<button>`，可 Tab 聚焦，`aria-label` 补全。
- 不要用 alert 做交互，用自定义 toast / modal。
- 空状态要有文案（比如错题本为空时"还没有错题，去练几题吧"）。

---

## 6. 数据现状（真实数据已就位，2026-10 实测）

`data/questions.json` 由 `tools/parse.py` + `tools/build.py` 从源 PDF 生成，**不要再手工覆盖它**。当前状态：

- `questions` 共 **2240** 条：单选 1185 / 多选 570 / 判断 485（`meta.typeTotals`）；
- 其中 `dupOf != null` 的重复题 **89** 条、`flags` 含 `broken` 的 **2** 条，**实际可练 2149 题**
  （单选 1101 / 多选 564 / 判断 484，即 `meta.types`）；
- 章节（`count` = 不含重复题与 broken 题的可用题数）：

  | id | 名称 | 可练 | 含重复 |
  |---|---|---|---|
  | c1 | 职业道德与职业素养 | 101 | 101 |
  | c2 | 工业设计与产品开发 | 131 | 131 |
  | c3 | 电工电子技术与元器件 | 276 | 277 |
  | c4 | 机械制图与机械设计 | 165 | 165 |
  | c5 | 电气自动化与机电一体化 | 208 | 209 |
  | c6 | 智能制造与工业互联网 | 108 | 160 |
  | c7 | 智能产品开发与用户体验 | 94 | 94 |
  | c8 | 电子信息与数字通信 | 92 | 98 |
  | c9 | 物联网与嵌入式 | 109 | 110 |
  | c10 | 智能控制与人工智能 | 202 | 203 |
  | c11 | 增材制造与3D打印 | 103 | 104 |
  | c12 | 装配工艺与生产管理 | 166 | 166 |
  | c13 | 先期质量策划与计量检测 | 199 | 205 |
  | c14 | 家用电器设计与维修 | 195 | 217 |

  **不要写死章节列表**，一切以 `chapters` 为准；前端仍要能容忍空章节不崩。
- 选项数量不保证 4 个：多为 4 项，判断题固定 2 项（T/F），布局必须按 `options.length` 自适应。
- `flags` 分布：空 2224、`figure` 7、`multi-single-answer` 4、`single-multi-answer` 2、`broken` 2、`image-missing` 1、`option-figure` 1、`no-answer` 1。
- 题干里的 `（　　）` 占位括弧原样显示；判断题题干不带占位符。
- `explain` 基本为空：判断题第 366 题起原卷附了简短说明，其余无解析。
- 本地验证数据：`python -m http.server 8123`。

### 章节是怎么来的（重要）

原 PDF 只有三个题型大段（p2 单选、p162 多选、p240 判断），**没有章节**。
build.py 用「题干关键词加权打分 + 题号段先验兜底」定章节：关键词只取专有名词，泛词权重 1，
避免「数据」「检测」这类词把题全吸到同一章；一道题关键词一分未命中时，按它在原 PDF 里的题号段
（`SEGMENTS`）归属。改章节词表后重跑 `tools/build.py` 即可。

---

## 7. 验收标准

1. `python -m http.server 8123` 打开 `http://localhost:8123/` 全部页面可访问，控制台无报错。
2. 走通：章节练习 → 多选判分（全对/漏选/多选三种情况）→ 错题进入错题本 → 收藏 → 模拟考试计时交卷 → 记忆曲线出现待复习 → 统计页数字变化 → 设置里切换乱序/深色模式 → 导出导入。
3. 2240 题规模下列表不卡顿；首页初始渲染 < 1s。
4. 刷新页面状态不丢（localStorage）。
5. 所有界面文案中文。
