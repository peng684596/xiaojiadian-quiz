# 小型家用电器制造工题库 · 刷题站

2024 全国行业职业技能竞赛——第四届全国工业设计职业技能大赛「小型家用电器制造工」决赛理论题库的刷题站。纯静态页面，原生 HTML + CSS + ES Modules，**零依赖、零构建**，直接部署到 GitHub Pages 仓库根目录即可使用。

**线上地址：<https://peng684596.github.io/xiaojiadian-quiz/>**

## 本地预览

```bash
cd xiaojiadian-quiz
python -m http.server 8123
```

然后浏览器打开 <http://localhost:8123/>。

不要直接双击 `index.html`：页面用 `fetch` 加载题库，`file://` 协议下会被浏览器的安全策略拦截。任意静态文件服务器都可以，不要求 Python。

## 功能

- **首页**：可练题数、已练题数、今日待复习、错题本数量四个数字卡；快捷入口；章节进度条；连续打卡。
- **章节练习**：十四个章节卡片入口，逐题作答。单选/判断点击即判，多选点「提交答案」判定，**全对才得分**，漏选多选都算错。
- **模拟考试**：范围（全部或指定章节）、题量（20/50/100/全部）、时长（30/60/90/120 分钟）可配；倒计时最后 60 秒变红，时间到自动交卷；答题卡支持跳题与标记；交卷后按题型拆解正确率并逐题回顾。
- **错题本**：答错自动收录，可按章节/题型筛选，支持连续答对提示、单题标记「已掌握」、清空与整体重练。
- **收藏**：练习中一键 ★ 收藏，集中重练。
- **记忆曲线**：简化 SM-2（1/2/4/7/15/30 天间隔），按等级从低到高安排今日复习。
- **统计**：累计答题与正确率、连续打卡、近 14 天答题量柱状图、各章节正确率、考试历史（最多 20 条）。
- **设置**：选项乱序（默认开）、自动下一题（默认关）、主题跟随系统/浅色/深色、包含重复题（默认关）、数据导出/导入/清空。

答题记录、错题、收藏、设置、统计与未完成的考试都保存在浏览器本地（`localStorage`，未完成考试在 `sessionStorage`），刷新不丢；不上传任何数据，换浏览器或清空站点数据会丢失，请用设置页的导出功能备份。

选项乱序是确定性的：按题目 id 与会话盐做 seeded shuffle，回看同一道题顺序不变；判断题永不打乱；判分始终映射回原始选项 key。

## 题库数据

`data/questions.json` 为运行时唯一数据源（当前 **2240** 条：单选 1185 / 多选 570 / 判断 485，其中 89 条重复题、2 条损坏题，**实际可练 2149 条**）。前端不写死题数、章节名或题目内容——**替换题库只需把同样 schema 的 JSON 覆盖到 `data/questions.json`，代码无需任何改动**。数据契约见 `docs/SPEC.md` 第 1 节。

- 章节不是原 PDF 自带的：原文件只有单选/多选/判断三个大段，章节由 `tools/build.py` 按题干关键词打分 + 题号段先验分出 c1–c14，所以个别跨主题的题可能落到相邻章。
- 原 PDF 判断题大题标题写「共 400 题」，实际印了 485 题，以实际为准。
- 89 条重复题默认不抽取，设置里可开「包含重复题」。
- 7 道读图题（电容印字、三极管/稳压二极管符号、二极管实物、三极管引脚、万用表读数、色环电阻）带裁切配图，存在 `assets/fig/`。
- 2 条损坏题永远不出现在练习里：多选 1147（四个选项全是矢量电路符号，文本层为空）、判断 423（原卷漏印括号答案，无从推断）。
- 原 PDF 自身有 4 道多选题只给了一个答案，仍按原答案计分并在题目上标注。

## 目录结构

```
index.html            页面骨架（顶栏 / 路由出口 / 底栏）
404.html              Pages 404 兜底，跳回仓库根
css/style.css         全部样式（CSS 变量主题 + 深色模式）
js/app.js             入口：加载题库、hash 路由、全局壳
js/store.js           localStorage 读写、设置、导入导出
js/srs.js             记忆曲线调度
js/quiz.js            出题队列、确定性选项乱序、判分
js/ui.js              DOM 辅助（h()、toast、modal、进度条、题干配图）
js/views/home.js      首页
js/views/chapters.js  章节列表
js/views/practice.js  练习流程与小结
js/views/exam.js      模拟考试设置 / 答题 / 成绩
js/views/wrong.js     错题本
js/views/favorites.js 收藏
js/views/review.js    记忆曲线
js/views/stats.js     统计
js/views/settings.js  设置
data/questions.json   题库数据
data/meta.json        meta + chapters 摘要
assets/fig/*.png      题干配图（7 张）
docs/SPEC.md          开发规格与数据契约
tools/parse.py        PDF → raw.json（构建期）
tools/build.py        raw.json → data/questions.json + 配图（构建期）
```

## 重新生成题库

构建期脚本需要 Python 3 + [PyMuPDF](https://pymupdf.readthedocs.io/)：

```bash
pip install pymupdf
python tools/parse.py tools/raw.json      # 需先把 PDF 路径改成自己机器上的
python tools/build.py                     # 出 data/questions.json 与 assets/fig/
```

`tools/raw.json` 是中间产物，已在 `.gitignore` 里排除。站点运行时**不加载** `tools/`。

## 部署

仓库 `main` 分支根目录 → GitHub Pages，地址 <https://peng684596.github.io/xiaojiadian-quiz/>。站点内所有路径均为相对路径，`https://<user>.github.io/<repo>/` 这类子路径可以直接工作；路由使用 hash（`#/chapters` 等），不需要服务器做 rewrite。

更新题库或改动代码后：

```bash
git add -A && git commit -m "更新题库" && git push
```

推送后 GitHub Pages 会在 1 分钟左右自动重新发布。

> 本机 git 全局配置里有一个指向 `127.0.0.1:23501` 的 GitHub 代理，该端口未监听会导致 `push` 报 `Failed to connect to github.com:443 over proxy`。本仓库在 `.git/config` 里用空代理覆盖处理（`[http "https://github.com"] proxy = `）；若换机器推送失败，用 `git -c http.https://github.com.proxy= push` 可绕过。

## 数据来源与许可

题库由赛事公开资料（PDF，260 页）解析整理而来，题目与标准答案的版权归原赛事主办方/出题方所有，本站仅用于个人学习备考，请勿用于商业用途。代码部分可自由参考、修改和使用，无第三方运行时依赖。
