---
name: build-jin10-breakfast
description: 生成金十财经早餐完整原文与九项核验行情，沿用浅米色邮件排版和无衬线数字，输出独立HTML、邮件HTML、TXT和审计JSON，可选导出中文文本PDF。用于按当天源文生成或显式历史演示，不负责发邮件或创建定时任务。
---

# 金十财经早餐

## 输出与边界

HTML是主输出，效果与确认的邮件版一致。保留标题、导语、所有新闻区块、段落、列表、加粗、免责声明和来源；不改写摘要，不补新闻。只保留包内顶部插画，排除原网页图片与音频行。在“今日优选”前加入九行行情。数值为Arial/Helvetica、正常字重、等宽、齐线的现代无衬线数字，涨跌右对齐。模块不显示逐行时间、合约/24小时/CMT说明或脚注；全部口径保留内部审计。PDF是可选导出，不是默认唯一产物。

此技能没有邮箱、收件人、发送或排程代码。网络读取仍须使用执行环境允许且可用的工具。没有行情连接器时不能声称已自动取齐九项。

## 当前生成

从本技能目录执行，先读README.md了解依赖。以下RUN为新的输出目录。

1. `python scripts/jin10_breakfast.py prepare --out RUN`。默认按北京时间当天，从金十专题发现当日文章，独立核对SSR与Nuxt发布时间。失败或未更新必须说明，不能退回前日。此步骤不下载任何正文图片。
2. `python scripts/quote_contract.py init --run-dir RUN/market`。这只创建新的取数请求和待填行，不提供行情值。
3. 阅读references/sources.md、market-input-contract.md和calendar-policy.md。通过当次可用的只读IBKR或可核验公开网页工具重新取数据，保存原始响应、确切参数、来源时间、采集时间、哈希和经官方来源核验的交易日历，填写RUN/market。不要读取资产持仓或凭证，不开户、不付费。公开源不可证实则标记unavailable，不能拿样例数字替补。
4. `python scripts/quote_contract.py validate --run-dir RUN/market`。核验同次请求绑定、市场开闭/午休/节假日/提前收市、准确标的、比较基准和新鲜度。开市用当期行情，休市用最近完整常规收盘，午休保留当前上午真实时间。BTC精确同分钟24小时，布油同一前月合约，美债官方10年CMT。任何口径变更先明确，不偷换代理。
5. `python scripts/jin10_breakfast.py render --out RUN --market-run RUN/market`。此入口强制重新校验输入；不接受旧quotes.json伪装当前。完整成功status=ready；部分缺失ready_degraded并明确“暂无可信报价”；全缺失失败且不得交付旧文件。
6. 检查status.json、原文全文一致性、9行顺序、只有一张插画，查看桌面/手机HTML。要PDF时按README命令导出并检查所有页面及全文核验结果。

## 历史示例与回归

`python scripts/run_example.py --out example-output --pdf`只重现2026-10-22 12:04北京的历史排版，状态始终preview_only/ready=false，不能用于当前日报。历史行情及其原始证据仅在examples/下。测试：`python -m unittest discover -s tests -v`。

全文/结构变化需检查而不是静默删段。已修复Nuxt变量名含`$`的解析，绝不执行网页脚本。日期、时区、延迟或数据来源不清时宁缺勿猜。详见references/output-and-failures.md。
