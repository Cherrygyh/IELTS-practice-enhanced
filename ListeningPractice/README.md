# 本地听力题库

已安装 IELTS-up 公开练习 Test 05–14，共 10 套、40 个分节、400 道题；P1–P4 各 10 个分节。题目、参考答案、40 个 MP3 和题目图示均保存在本地，打开练习后无需联网。

## 使用

1. 双击项目根目录 `index.html`。
2. 点击「题库浏览」→「听力」。
3. 如列表为空，取消已选中的「高频 / 中频 / 低频」筛选，清空搜索词。
4. 找到 `IELTS-up Test 05 · Part 1` 等条目，点击「开始练习」。
5. 播放顶部音频，在右侧答题卡按原题号填写答案，点击「提交并评分」。结果通过项目原有的听力记录桥接模块回传。

搜索 `Test 05` 可找到同一套的四个分节。选择题填写字母；连续题号多选题每格填一个字母，顺序不限；一个题号要求多个答案时用逗号分隔。可以展开「查看原站参考答案」核对原站答案。题目使用 HTML，因此没有单独配套 PDF；从「开始练习」打开完整题目。

## 听力原文与复盘

音频播放结束，或点击「提交并评分」后，答题卡下方的「查看听力原文」按钮会开放。点击可展开原文，再次点击可收起；只听音频、查看原文不会提交成绩。

原文由本机音频自动转写，页面明确标注「自动转写，可能有误」，请以音频为准。每节目录中的 `transcript.json` 保存文本、时间戳、模型及音频校验值；`transcript.js` 提供浏览器离线加载。保留这两个文件即可在 `file://` 和本地服务器下查看，无需安装转写工具或联网。

需要重新生成时，可在独立 Python 环境安装 `mlx-whisper`、`imageio-ffmpeg`，然后运行 `developer/tests/tools/listeningpractice/transcribe_local_audio.py`。该工具面向 Apple Silicon Mac，首次下载模型后在本机处理音频；可按 `--test`、`--part` 选择分节，使用 `--overwrite` 重新转写。

生成工具将时间戳限制在实际音频时长内。转写结果仍需核对，本次已核查并修正六节末尾的误识别或越界片段。

## 成绩统计修复

桥接模块按完整样式名称识别对错，避免把错题的 `incorrect` 识别为 `correct`。未作答题计入总题数，得分和练习记录应与本节结果表一致。

对于本批 Test 05–14 中被旧桥接误记为满分的单节记录，系统会在读取时使用保存的十题作答及可接受答案重算，统一历史详情和统计显示。原始存储保持不变；缺少完整作答或可接受答案的旧记录保留原值，无法凭空恢复。

## 来源

- 目录：https://ielts-up.com/listening/ielts-listening-practice.html
- 每节原始页面、音频链接、校验值：`sources.json`
- 原始页面快照：`_sources/*.html.txt`
- 下载日期：2026-10-24

这些是 IELTS-up 公开练习，不能据此宣称为 IELTS 官方真题。保留了原题、参考答案和图示；本地页面使用独立答题卡。原站斜线分隔的可选答案、括号内可省略的词及多选顺序均作了兼容；Test 11 P2 的原站拼写 `Accomodation` 和标准拼写 `Accommodation` 都接受。原内容版权归其权利人所有，本地副本供个人学习。

## 官方接入方式

遵循本项目 `README.zh-CN.md` 的本地听力扩展约定，使用仓库原有工具完成规范化、记录桥接和索引生成，沿用主入口与现有阅读题库：

```sh
python3 developer/tests/tools/listeningpractice/normalize_listeningpractice_html.py --root ListeningPractice --title-mode keep --write
python3 developer/tests/tools/listeningpractice/generate_listening_assets.py
```

生成的索引是：

- `assets/generated/listening-exams/manifest.js`
- `assets/generated/listening-exams/listening-index.compat.js`

备份或迁移时，保留整个 `ListeningPractice` 文件夹及上述两个索引文件。若打包项目供个人使用，按项目说明设置 `INCLUDE_LOCAL_LISTENING=1`，普通发布包默认会排除听力材料。
