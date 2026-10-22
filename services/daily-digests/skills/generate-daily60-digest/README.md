# 每日60秒 · 完整可移植技能包

默认生成 HTML 文字日报，不是 PDF。内容和版式沿用已确认的每日60秒邮件版本：米色刊头、原创世界/时钟线描、完整编号新闻、每日寄语、公历/星期/农历，以及纯文字来源日期。新闻间距已缩小，无原文按钮、无页底灰色说明。

## 环境

- 核心生成器只依赖 Python 标准库；验证环境 Python 3.12.14，支持 Python 3.10+。
- 在线模式需 HTTPS 访问新闻主/备源与香港天文台；无需密钥或登录。
- PDF 可选：固定依赖要求 Python 3.11+，建议 Python 3.12；WeasyPrint 70.0 及其固定版本依赖，见 `requirements-pdf.txt`。
- 中文排版需要本机中文字体，例如 Noto Sans CJK SC、思源黑体或系统中文字体。字体未打包。PDF 另需 Pango 等 WeasyPrint 系统依赖，安装指引：https://doc.courtbouillon.org/weasyprint/stable/first_steps.html 。不同系统/字体可能改变断行。
- `requirements-test.txt` 增加 PDF/PNG 验证工具 PyMuPDF。HTML/TXT/JSON 不需要安装这些依赖。

建议在独立环境安装（Windows 可用 `py -3` 替换 `python3`）：

    python3 -m venv .venv
    # macOS/Linux:
    . .venv/bin/activate
    # Windows PowerShell:
    # .venv\Scripts\Activate.ps1
    python -m pip install -r requirements-pdf.txt

这里只给出安装方法，不自动安装到某个助手或修改系统设置。将整个 `generate-daily60-digest` 文件夹放入目标助手支持的技能目录即可；也可不安装技能，直接运行 CLI。

## 生成今日版本

在包根目录运行：

    python scripts/daily60.py --outdir output

默认“今日”为北京时间 UTC+08，与你电脑时区无关。显式指定日期：

    python scripts/daily60.py --date 2026-10-22 --outdir output/2026-10-22

输出：

- `daily60-YYYY-MM-DD.html`：主结果，自包含 HTML，刊头使用内嵌数据，不需联网加载图片。
- `daily60-YYYY-MM-DD.txt`：同样新闻、寄语和日期的纯文字版。
- `daily60-YYYY-MM-DD.json`：只保存所需文本字段，不保存原站图片字段。
- `calendar-YYYY-MM-DD.json`：单独的官方农历记录及日期。
- `daily60-YYYY-MM-DD.manifest.json`：本次来源、日期、数量、校验摘要和输出清单。

源条数变化时完整保留全部条目。没有当天内容就报错，不回退昨天、不复用历史输出。源寄语不存在时省略寄语卡片。

## 可选 PDF

    python scripts/daily60.py --outdir output --pdf

默认导出纵向长页，与 HTML 的桌面布局一致，适合屏幕阅读。分页打印版：

    python scripts/daily60.py --outdir output --pdf --pdf-layout a4

也可只转换已生成的独立 HTML：

    python scripts/export_pdf.py output/daily60-2026-10-22.html --output output/daily60-2026-10-22.pdf

PDF 保留可提取文字，不是把日报截图塞入 PDF。正文文字与 HTML 相同，但字体度量、分页及不同邮件客户端渲染不保证逐像素一致。PDF 失败时退出码为2，HTML/TXT/JSON 可能已保存；检查 manifest，不能把这次运行称为全部成功。

## 生成可交给邮件工具的正文

    python scripts/daily60.py --outdir output --email-html

额外输出 `daily60-YYYY-MM-DD.email.html` 和 `header-art.png`。发送端需将 PNG 作为 inline MIME 部件，Content-ID 为 `daily60-header`。不要把整张预览作为邮件主体；不要用 CID 版本做独立浏览或 PDF 导出。

技能内不含 SMTP/Gmail、邮箱地址、凭据、自动发送、定时任务、安装定时任务或重复发送逻辑。需要发送/调度时，由外部已获授权的流程调用本命令。

## 离线复现示例

`sample/input/` 是明确标注日期的历史演示资料，不是自动备用数据源：

    python scripts/daily60.py --date 2026-10-22 --input sample/input/news-2026-10-22.json --calendar-input sample/input/calendar-2026-10-22.json --outdir output/offline --email-html

PDF 复现加 `--pdf`。离线模式校验保存记录的日期和内部字段一致性，不声称重新查询了天文台。未来日期必须重新在线取数，不能只改文件名、日期或农历。

## 测试与结构

    python -m unittest discover -s tests -v
    python -m pip install -r requirements-test.txt
    python scripts/verify_outputs.py output/offline/daily60-2026-10-22.html --news sample/input/news-2026-10-22.json --calendar sample/input/calendar-2026-10-22.json --outdir output/qa

若有 PDF，在上述最后一条命令增加 `--pdf output/offline/daily60-2026-10-22.pdf`。验证脚本检查原文与顺序、日期、寄语、无被移除控件、800/390/320px 版面溢出，并输出真实渲染 PNG；它不是某个具体邮件客户端兼容性保证。

`SKILL.md` 是智能体入口；`scripts/` 为生成/导出/检查；`templates/` 为 HTML；`assets/` 是原创刊头；`references/` 为来源和验收说明；`tests/` 是离线测试；`sample/` 为带日期的输入及已验证输出。

来源文字和短寄语不因仓库声明而自动取得第三方版权授权。新闻事实和来源范围不作额外改写；来源与使用边界见 `references/sources.md`。
