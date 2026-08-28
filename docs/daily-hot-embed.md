# DailyHot 今日热榜入口

新闻页 `/signals` 顶部统计区域下方新增「今日热榜」卡片，点击进入 `/signals/daily-hot`。保留原新闻筛选查询参数，页面内「返回今日新闻」恢复原筛选。

## 集成方式

- 嵌入 [imsyy/DailyHot](https://github.com/imsyy/DailyHot) README 提供的在线示例站点 `https://hot.imsyy.top/`。
- 这是外部网页嵌入，不是将 Vue 源码或 DailyHotApi 部署到 SparkFlow，也不与现有新闻采集、评分、缓存合并。
- 仅进入热榜子页面时加载第三方页面；新闻首页卡片不预加载远程页面、截图或 API。
- 截至 2026-08-28，示例站点返回 HTTP 200，未设置禁止嵌入的 X-Frame-Options 或 CSP frame-ancestors 响应头。后续站点策略可能变化。
- 保留原作者页面与项目链接。未复制上游源码或静态资源，无新增依赖。

## 边界与容错

- iframe 使用固定 HTTPS 地址、`no-referrer`，不传递新闻查询参数、SparkFlow API Key、设置或本地数据。
- sandbox 允许运行页面、跨域页面自身存储及用户点击后新开原文；不允许嵌入页导航顶层 SparkFlow 窗口。不开放相机、麦克风、定位或剪贴板权限。
- 提供「重新加载」「新窗口打开」及始终可见的空白/报错处理说明。12 秒未收到 iframe 导航事件显示加载较慢提示。
- 跨域 iframe 的 onLoad 不能证明内部每个榜单加载成功，界面不声称所有数据源已连接。原站的错误和数据更新时间在嵌入页面内部显示。
- 若以后需要本地部署，可单独部署 DailyHot 和 DailyHotApi，再更新组件的固定地址；本次没有新增后台服务或部署任务。

## 验证

- `npm run build` 检查路由组件和 TypeScript。
- 浏览器检查卡片跳转、内嵌榜单、重新加载、返回筛选，以及原站链接。
- 2026-08-28 实测：外部页面可嵌入，榜单卡片出现“哎呀，加载失败了”。仓库配置的 `https://api-hot.imsyy.top` 在当前环境解析失败（`getaddrinfo ENOTFOUND`），直接及代理请求均失败。不能将 iframe 导航成功当作热榜数据已可用；需要上游恢复服务或另行部署前端及 API 才能解决该上游问题。
