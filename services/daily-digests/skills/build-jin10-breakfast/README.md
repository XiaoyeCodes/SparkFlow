# 金十财经早餐技能包

这是一个可移植的agent技能，不是已经登录所有数据商的独立行情终端。默认生成与确认邮件一致的HTML，附TXT及审计JSON；PDF为可选中文文本导出。

## 安装与能力

把整个`build-jin10-breakfast`目录放入你的agent技能目录，或让支持读取SKILL.md的agent使用它。无需安装为系统技能也能运行脚本。

Python 3.10以上：

```sh
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
```

正文脚本使用标准HTTPS请求和lxml。行情由agent的已连接只读IBKR工具或可访问公开网页工具取得，按机器可校验JSON契约输入。包内不含账号、API密钥或收费源。纯Python脚本不会自行接通IBKR，也不能保证九项公开行情都可取得；缺失会明确显示，全部缺失会失败。不要绕过网站或连接器的拒绝。

## 每次生成

```sh
python scripts/jin10_breakfast.py prepare --out output/today
python scripts/quote_contract.py init --run-dir output/today/market
```

此时agent按SKILL.md及references/中的取数/日历/输入契约，使用本环境实际存在的工具完成新的quotes.json、calendar.json和evidence/manifest.json。init只产生待填字段，不产生示例数值。

```sh
python scripts/quote_contract.py validate --run-dir output/today/market
python scripts/jin10_breakfast.py render --out output/today --market-run output/today/market
```

每次使用新的目录。不要把`today`目录里的旧文件当成本次成功。先读status.json；结构/日期/行情全部失败均不是“暂无新闻”。北京时间08:00是原使用场景，不在技能中创建定时任务；任意运行时刻都先判断市场真实状态。

主要产物：
- breakfast.html：可离线打开的独立HTML，顶部插画内嵌。
- breakfast-email.html：同一内容的CID版本，供另行授权的邮件工具使用。
- breakfast.txt：可读纯文本。
- news.json、market-verified.json、status.json：内容及核验状态。
- jin10-masthead-art.png、inline-attachments.json：唯一插画和相对路径CID清单。

## 可选PDF

安装Pango、Harfbuzz和可覆盖简体中文的字体，例如Noto Sans CJK SC、Noto Serif CJK SC，再安装PDF可选依赖：

```sh
python -m pip install -r requirements-pdf.txt
python scripts/export_pdf.py --html output/today/breakfast.html --news-json output/today/news.json --out output/today/breakfast.pdf --qa-dir output/today/pdf-qa
```

系统依赖请按[WeasyPrint官方安装文档](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html)配置。PDF脚本使用WeasyPrint70，生成可选中/搜索的中文文本，不把长截图装进PDF。打印样式仅调整分页间距，新闻与数值不变。脚本检查原文每块文本完整，输出逐页PNG供人工查看；若缺字体或依赖，HTML仍可用，PDF应明确失败而非用乱码替代。A4分页不能与连续滚动邮件在每一像素上相同。

## 离线历史演示与测试

```sh
python scripts/run_example.py --out output/historical-demo
# 已安装PDF依赖时，可加 --pdf
python -m unittest discover -s tests -v
```

历史演示是2026-10-22 12:04北京的固定、已核验样例。它明确输出preview_only且ready=false，不会改采集时间，也不会冒充执行当天行情。examples/historical-2026-10-22下附完整HTML、TXT、原始取数证据及4页文本PDF。生产代码不读取此目录。

## 授权与内容

只处理用户请求的来源内容。原文和市场数据仍属于其各自来源；本包不授予再分发、交易所数据授权或商业发布许可。输出不构成投资建议，原站免责声明原样保留。不含邮件发送、Gmail、定时器、收件人或秘密信息。
