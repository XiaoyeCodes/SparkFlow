# 浏览器只读备用提取

适用情形：静态 HTML 没有正文、来源改动导致严格解析失败、当前网络路径无法取页。使用宿主已经可用的浏览器工具，不要求特定插件、账户或内部工具。

1. 打开 https://news.aibase.cn/daily 。忽略“几小时前/几天前”；逐个打开最新候选文章，读取“发布时间”后的完整年月日和时间。核实目标北京时间同日内最新文章。若列表发生重排或无法完整核验，不宣称选中了最新文章。
2. 在文章页核对 .articleContent 内每个编号标题和随后对应的 blockquote。一个标题应对应一个提要，按原顺序配对。正文说明、产品链接、图片、页面导航都不进入结果。
3. 将浏览器渲染后的标题与提要段落文本原样保存为下面格式。仅移除每段外围空白，不折叠段内空格或改标点。raw_abstract 必须恰为 summary_label 加全部 bullets，中间以两个换行连接。这让导入器能检查只删了标签、未删提要。
4. 支持只读 DOM 求值的宿主可执行下面脚本读取 JSON。脚本不发请求、不写页面、不点击、不运行来源中的脚本。若宿主不支持求值，用它现有的网页读取方式按同样结构提取；不要换工具来绕过访问拒绝。
5. 将结果保存为 UTF-8 extraction.json，运行 SKILL.md 的 --input-json 命令。默认仍拒绝非北京时间当天文章。导入模式无法重新证明浏览器选择了最新文章，选择和完整性核验由执行者负责。

```javascript
(() => {
  const label = /^【\s*AiBase\s*提要\s*[:：]?\s*】$/i;
  const numbered = /^\d+[、.．]\s*\S/;
  const text = node => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName) || node.hasAttribute("hidden")) return "";
    if (node.tagName === "BR") return "\n";
    return [...node.childNodes].map(text).join("");
  };
  const read = el => text(el).trim();
  const fields = [...document.querySelectorAll("span")]
    .filter(el => /^\s*发布时间\s*[:：]?\s*$/.test(read(el)));
  const dates = [...new Set(fields.flatMap(el =>
    [...el.parentElement.innerText.matchAll(/\d{4}年\d{1,2}月\d{1,2}[日号]\s+\d{1,2}:\d{2}/g)]
      .map(m => m[0])))];
  if (dates.length !== 1) throw Error("Missing or ambiguous absolute publication date");
  const containers = document.querySelectorAll(".articleContent");
  if (containers.length !== 1) throw Error("Expected one article container");
  const root = containers[0].querySelector(".post-content") || containers[0];
  let pending = null;
  const items = [];
  for (const el of root.children) {
    const text = read(el);
    if (/^(P|H2|H3|H4)$/.test(el.tagName) && numbered.test(text)) {
      if (pending !== null) throw Error("Unpaired heading");
      pending = text;
    } else if (el.tagName === "BLOCKQUOTE") {
      if (pending === null) throw Error("Unpaired blockquote");
      if ([...el.children].some(c => c.tagName !== "P")) throw Error("Changed blockquote structure");
      if ([...el.childNodes].some(c => c.nodeType === 3 && c.textContent.trim())) throw Error("Stray summary text");
      const parts = [...el.children].map(read).filter(Boolean);
      if (parts.length < 2 || !label.test(parts[0]) || parts.filter(p => label.test(p)).length !== 1)
        throw Error("Missing or ambiguous summary label");
      items.push({heading: pending, summary_label: parts[0], bullets: parts.slice(1),
                  raw_abstract: parts.join("\n\n")});
      pending = null;
    }
  }
  const allHeadings = [...root.querySelectorAll("p,h2,h3,h4")]
    .filter(el => !el.closest("blockquote") && numbered.test(read(el)));
  if (pending !== null || items.length === 0 ||
      items.length !== root.querySelectorAll("blockquote").length ||
      items.length !== allHeadings.length)
    throw Error("Heading/summary mismatch");
  if (items.some((item, index) => Number(item.heading.match(/^\d+/)[0]) !== index + 1))
    throw Error("Missing/duplicated original item number");
  const titles = [...document.querySelectorAll("h1")];
  if (titles.length > 1) throw Error("Ambiguous article title");
  return JSON.stringify({
    source_url: location.href,
    article_title: titles.length ? read(titles[0]) : document.title,
    publication_text: dates[0],
    extraction_method: "Rendered DOM; original numbered headings and complete blockquote paragraphs",
    items
  }, null, 2);
})()
```

JSON 结构示意（这里是结构示例，不是可冒充今日新闻的内容）：

```json
{
  "source_url": "https://news.aibase.cn/daily/31727",
  "article_title": "原文章标题",
  "publication_text": "2026年10月19号 16:13",
  "extraction_method": "Rendered DOM",
  "items": [
    {
      "heading": "1、原编号标题",
      "summary_label": "【AiBase提要:】",
      "bullets": ["第一段完整提要", "第二段完整提要"],
      "raw_abstract": "【AiBase提要:】\n\n第一段完整提要\n\n第二段完整提要"
    }
  ]
}
```

也可保存已渲染页面 HTML 后运行 --input-html rendered.html --article-url 已核实的网址。保存 HTML 不是保存截图；截图不足以可靠恢复原始字符。不要手动补齐辨认不清或缺失内容。
