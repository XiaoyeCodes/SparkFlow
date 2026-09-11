# 腾讯美股市盈率字段核验

核验日期：2026-09-11。仅使用腾讯页面代码、行情与财务接口；未用东方财富补值。

## 结论与证据强度

- `qt[ticker][39]`：TTM 市盈率。腾讯行情中心代码将行情字段 39 映射为 `pe_ttm` / `peTTM`；个股旧页面仅显示“市盈率”。
- `qt[ticker][41]`：静态市盈率。腾讯官方移动端适配器 `adaptUS` 将其映射为 `lyr_ratio`，并已通过腾讯年度 EPS 交叉核验。
- `qt[ticker][65]`：动态市盈率。腾讯官方移动端适配器 `adaptUS` 明确映射为 `dynamic_ratio`，直接取接口值，不再按季度 EPS 计算。
- 不要套用沪深股票字段索引。美股数组中的第 52、53 项不按沪深静态/动态 PE 的映射读取。
- 有限负值正常保留；空值、`-`、非数值和零占位符保持缺失。TTM 不替代静态，静态不替代动态。

## 腾讯原始来源

- [腾讯行情中心](https://stockapp.finance.qq.com/mstats/)
- [腾讯移动行情入口](https://gu.qq.com/resources/shy/cms/qq.html?code=usAAPL)
- [腾讯移动端官方适配器](https://wzq.gtimg.com/mp/v2/js/chunk-vendors.62704902.js)：搜索 `adaptUS:function`，其中 `dynamic_ratio:e[65]`、`lyr_ratio:e[41]`。注意 `adaptHK` 使用其他索引。
- [行情中心页面脚本](https://st.gtimg.com/quotes_center/assets/index.9eebe9c3.js)：搜索 `pe_ttm`、`39:"peTTM"`。
- [腾讯美股页面脚本](https://st.gtimg.com/quotes/us/bundle.f038d542.js)：报价从 `r[39]` 展示，财务页使用 `appstock/us/finDetail/search`。
- [AAPL 原始行情](https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL,day,,,2,qfq)：`data.usAAPL.qt.usAAPL`，索引从 0 开始。
- [AAPL 命名行情](https://web.ifzq.gtimg.cn/portable/mobile/qt/data?code=usAAPL.OQ)：`pe=37.45`、`psy=8.72`，对应 TTM PE 与每股收益。
- [MSFT 财务明细](https://web.ifzq.gtimg.cn/appstock/us/finDetail/search?symbol=MSFT.O&type=income)
- [NVDA 财务明细](https://web.ifzq.gtimg.cn/appstock/us/finDetail/search?symbol=NVDA.O&type=income)
- [TSLA 财务明细](https://web.ifzq.gtimg.cn/appstock/us/finDetail/search?symbol=TSLA.O&type=income)
- [AAPL 财务明细](https://web.ifzq.gtimg.cn/appstock/us/finDetail/search?symbol=AAPL.O&type=income)

财务明细的 `data.data` 是报表列表。核对“年报”列、“摊薄每股收益”行以及“显示币种”为美元；该接口股票参数使用 `AAPL.O` / `AAPL.OQ`，不能直接照搬行情接口的 `usAAPL` 前缀。

## 同源数值对照

| 股票 | 行情价格 USD | 字段 39 | 字段 41 | 腾讯年报期 | 年报摊薄 EPS USD | 价格 / 年报 EPS |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| MSFT | 492.44 | 27.43 | 27.43 | 2026-06-30 | 17.95 | 27.43 |
| NVDA | 218.36 | 27.61 | 44.56 | 2026-01-31 | 4.90 | 44.56 |
| TSLA | 363.56 | 336.63 | 336.63 | 2025-12-31 | 1.08 | 336.63 |
| AAPL | 326.57 | 37.45 | 43.78 | 2025-09-30 | 7.47 | 43.72 |

AAPL 的两个腾讯接口存在小幅不一致：字段 41 隐含 EPS 约 7.4593，财务明细显示 7.47。尚不能确认是更新时间、精度还是口径细节导致，因此保留行情直接返回的 43.78，不以财务明细重算覆盖，也不将差异描述为已解释。

## 实现范围

腾讯模式直接从同一次行情响应读取 39、41、65，不调用东财补充。缓存仍按数据源隔离。

交易页面按所选数据源展示：腾讯为“市盈率（TTM）”“市盈率（动）”；东财为“市盈率（TTM）”“市盈率（静）”，读取 `f164`、`f163` 原值。切换源时同步切换标题和值。

## 腾讯动态字段 65 的直接验证

之前只检查了旧网页和命名行情接口，漏接美股数组后部的字段 65。现已通过官方 `adaptUS` 源码确认。已移除财报年化计算服务、财报缓存、额外财务请求和计算标注；界面直接显示源值。

- 两条官方行情接口 `[qt.gtimg.cn/q=usAAPL](https://qt.gtimg.cn/q=usAAPL)` 和 `usfqkline/get` 的对应数组都返回字段 65。
- `portable/mobile/qt/data` 只暴露名为 `pe` 的 TTM 指标，不能据此认定腾讯无动态数据。
- 任何无效、空或零占位的动态字段仍保持缺失，不再自行计算，也不以静态或 TTM 替代；有限负值正常保留。

2026-09-11 使用实际生产报价类与腾讯实时接口验证：

| 股票 | 股价 USD | TTM PE `[39]` | 静态 PE `[41]` | 动态 PE `[65]` |
| --- | ---: | ---: | ---: | ---: |
| AAPL | 326.57 | 37.45 | 43.78 | 35.60 |
| MSFT | 492.44 | 27.43 | 27.43 | 27.43 |
| NVDA | 218.36 | 27.61 | 44.56 | 22.51 |

生产报价类实测每只股票一次 `web.ifzq.gtimg.cn/appstock/app/usfqkline/get` 请求，无财报请求，无自行计算。
