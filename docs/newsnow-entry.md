# NewsNow 今日热榜入口

2026-10-22：新闻页 `/signals` 的“今日热榜”卡片改为在新窗口打开 <https://newsnow.busiyi.world/>。其他已有 NewsNow 入口共用同一固定地址。

卡片使用普通HTTPS链接和 `noopener noreferrer`，不附带新闻筛选条件或本地配置。访问 SparkFlow 或新闻页不会预加载 NewsNow，也不会在后台抓取其内容。旧 `/signals/daily-hot` 书签回到新闻页，并保留原新闻筛选参数。

此前的本地热榜页面、API代理、子进程管理、安装脚本、服务包与对应测试已经移除；`dev`、`build`、`preview` 不再安装或启动该热榜服务。

当前网络对 NewsNow 请求返回Cloudflare 403及 `X-Frame-Options: SAMEORIGIN`，无法保证跨站iframe可用，因此使用原站链接。原站的可访问性、验证页面及榜单更新由NewsNow负责，SparkFlow不宣称已加载其全部数据源。

浏览器回归：`tests/ibkr/newsnow-entry.spec.ts`，验证链接、新窗口访问、无后台热榜请求及旧书签筛选保留。
