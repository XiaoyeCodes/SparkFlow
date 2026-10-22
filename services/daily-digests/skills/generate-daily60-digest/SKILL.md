---
name: generate-daily60-digest
description: Generate the Daily60 Chinese news digest from same-date JSON as selectable-text beige HTML, TXT and JSON, with the source daily tip and verified Gregorian, weekday and lunar dates; optionally export PDF. Use for Daily60 reports, not AIBase or financial digests.
---

# 每日60秒文字日报

生成已确认的米白、米色文字版日报。默认结果是可选中、可复制的 HTML 正文，同时生成 TXT、JSON 和校验记录；PDF 为可选导出，不是默认邮件内容。本技能不发送邮件、不安装定时任务、不保存邮箱或账号。

## 执行

在技能根目录使用 Python 3.12（核心生成器兼容 3.10+，PDF 固定依赖需 3.11+）：

`python scripts/daily60.py --outdir output`

默认按北京时间当天取数。只接受该日 JSON；主源失败后仅尝试同日 GitHub 备用源。两者都失败、日期不符或官方农历查询失败就停止，不能拿昨日内容或示例冒充今日。

需要 PDF 时，先按 [README.md](README.md) 安装可选依赖，再执行：

`python scripts/daily60.py --outdir output --pdf`

默认 PDF 是与日报相同布局的纵向长页；加 `--pdf-layout a4` 生成分页打印版。字体和分页不保证与所有邮件客户端逐像素一致。

## 内容和版式约束

- 按 `news` 原始顺序保留全部条目及文字，不固定为15条、不补充研究或投资分析。
- 保留源 `tip` 为“每日寄语”；缺失或空值时不杜撰寄语。
- 公历来自严格匹配的 `date`，星期由该公历计算。农历来自香港天文台同日接口，与新闻字段分开，不宣称 JSON 自带农历。
- 不下载源 `image`、`cover`，不 OCR，不用第三方新闻图片。仅使用包内原创线描刊头。
- 保留 640px 暖米白版式、16px 正文、1.8 行高，新闻上下内边距桌面16px、手机14px。
- 保留纯文字来源和日期。不要恢复原文按钮，也不要恢复页底灰色说明行。

## 输出检查与交付

确认命令退出码为0且当次 `.manifest.json` 的 `status` 为 `success`；核对日期、新闻数量、寄语、农历及正文顺序。失败时不能拿旧目录中已有文件当新结果交付。

用浏览器打开生成的 `.html`；PDF 导出后渲染检查中文字体、完整内容和边界。可运行 `python -m unittest discover -s tests -v`，以及 [references/validation.md](references/validation.md) 中的版面检查。交付 HTML 为主，用户要求时附 PDF/TXT；不要仅发送截图。

若另有明确邮件发送任务，可加 `--email-html` 生成 CID 正文与内联刊头资源，交给已获授权的发送流程。本技能没有发送代码，不从示例或文档推断收件人、重复推送或定时授权。

离线复现、目录结构和安装见 [README.md](README.md)。字段、来源、授权边界见 [references/sources.md](references/sources.md)。
