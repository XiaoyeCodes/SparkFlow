# AIBase 日报技能包 V7

## 运行后会得到什么

- aibase-YYYY-MM-DD.html：主产物，与确认的 V7 邮件视觉一致，可离线直接打开。机器人 PNG 已内嵌，无需保持素材文件与 HTML 在一起。
- .txt：同一份原标题、全部提要及原文链接。
- .json：完整提取数据、真实发布时间、动态条目/段落数量、原标签证据。
- .pdf：只在加 --pdf 或调用 PDF 导出脚本时生成。A4 分页，保留原内容、配色、机器人及原文按钮；打印版会紧凑调整正文间距并加页码。

默认按运行时北京时间周一至周五生成当天日报；当天没有新稿时不会使用昨天的内容。技能包不包含邮件发送、账号绑定或定时器。将 aibase-daily 整个目录放到支持 SKILL.md 的宿主技能目录，或者直接运行脚本。安装宿主本身不在本包范围内。

## 最小运行环境

HTML/TXT/JSON 只需 Python 3.9+ 标准库，无需 API key、账户或额外 Python 包。推荐 Python 3.10+，以便启用可选 PDF。

在本目录运行：

```sh
python3 scripts/aibase_daily.py --out-dir output
```

首次联网需要访问 https://news.aibase.cn/daily 及其文章页。脚本只读公开网页，按可见的绝对发布时间确认当日最新文章。失败时见下面状态表和 references/browser-fallback.md，不要把历史样例当成备用新闻。

## 可选 PDF 环境

已实测：Python 3.12、WeasyPrint 70.0、PyMuPDF 1.26.6、Linux Pango/Fontconfig、Noto Sans CJK SC 与 Noto Color Emoji。包内不捆绑字体、浏览器或系统库。

建议使用隔离环境：

```sh
python3 -m venv .venv
# macOS / Linux
. .venv/bin/activate
# Windows 改用 .venv\Scripts\activate
python -m pip install -r requirements-pdf.txt
python -m weasyprint --info
```

WeasyPrint 70.0 需要 Python 3.10+ 和 Pango 1.44+。Linux 需安装发行版对应的 Pango/Fontconfig 系统包及中文、emoji 字体，例如 Debian/Ubuntu 的 fonts-noto-cjk、fonts-noto-color-emoji。macOS 可使用 Homebrew 安装 WeasyPrint/Pango；Windows 需按官方文档配置 Pango DLL。安装需要你对该环境有相应权限，本包不会自动安装系统软件。

详细平台步骤以 [WeasyPrint 官方安装文档](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html) 为准。缺中文字体时不要交付方框字 PDF；先修复字体或改交独立 HTML。

```sh
python scripts/aibase_daily.py --pdf --out-dir output
# 或把已经生成的 HTML 导出为 PDF
python scripts/export_pdf.py output/aibase-YYYY-MM-DD.html
```

PDF 渲染只允许内嵌数据图片，不访问外部资源。缺少依赖时 HTML/TXT/JSON 不受影响。浏览器自带“打印为 PDF”可作手工备用，但分页和字体因浏览器而异，仍须逐页检查。

## 历史样例与离线验收

examples/ 是 2026-10-21 历史展示，不是当前日报。tests/fixtures/ 是对应的公开原文测试数据。显式日期仅供用户明确请求的历史复现：

```sh
python3 scripts/aibase_daily.py --date 2026-10-21 --input-html tests/fixtures/article-2026-10-21.html --article-url https://news.aibase.cn/daily/31782 --out-dir sample-output
python3 scripts/aibase_daily.py --date 2026-10-21 --input-json tests/fixtures/article-2026-10-21.json --pdf --out-dir sample-output
```

正常在线历史运行可用 --date YYYY-MM-DD；较早文章不在当前列表时，另提供已核实的 --article-url。任何已知网址或输入文件都不能绕过日期校验。历史状态记录在 JSON 和 HTML 元数据中；可见版式不新增标签，正文日期永远是原文实际日期。

## 状态与退出码

| 状态 | 退出码 | 含义 |
|---|---:|---|
| ok | 0 | 文件已生成，输出路径在结果 JSON 中 |
| skipped_weekend | 0 | 默认周末不运行，无取稿和输出 |
| no_article_for_date | 3 | 核验后无目标日文章，或导入文件日期不符；不回退旧稿 |
| error | 2 | 网络、绝对日期、结构或配对核验失败；不是已确认缺稿 |
| pdf_export_failed | 4 | PDF 未生成成功；查看已生成的其他文件及具体错误 |
| qa_failed | 5 | QA 发现遗漏、未解析占位符、错误图片/链接或 PDF 内容问题 |

没有 --date 时，即使提供旧输入文件，也不会自动切换到旧日期。每次任务使用独立输出目录更容易避免误交先前文件；失败时不要发送目录里残留的旧稿。

## 核验命令

```sh
python3 -m unittest discover -s tests -v
python3 scripts/qa_outputs.py sample-output/aibase-2026-10-21.json sample-output/aibase-2026-10-21.html --pdf sample-output/aibase-2026-10-21.pdf --render-dir sample-output/pdf-pages
```

QA 逐字比对 HTML 的全部原标题/提要，核对 PNG 原字节、按钮链接和动态数量。PDF 检查正文完整性与非空页面；--render-dir 导出逐页 PNG。最后人工或视觉工具查看每页，不能仅凭退出码判断版面。

## 文件结构

SKILL.md 是智能体执行入口；scripts/ 是抓取、渲染和核验程序；assets/ 含 V7 模板与机器人 PNG；references/ 含只读浏览器备用方案；tests/ 含单元测试和历史原文；examples/ 含可直接打开的历史 HTML/PDF/TXT/JSON。

字号与颜色属于 V7 模板，日期、原文 URL、条目数和提要数来自当次抓取，不写死。提要中的非 emoji 段落（例如“详情链接”）也必须完整保留。
