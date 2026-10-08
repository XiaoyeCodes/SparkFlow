# 每日简报部署配置

SparkFlow 运行时会在北京时间每个整点后台更新简报。启动时恢复最近一次成功快照，如果本小时尚未更新则补齐；运行中每分钟检查失败重试和休眠恢复。公网部署还可以启用 `.github/workflows/daily-briefing.yml` 作为每小时的冗余触发器。

更新期间访客直接读取最近一次成功快照，新版写入成功后才替换。失败保留原日期和生成时间，后台一分钟后重试；超过24小时的快照不会当作当前数据展示。

## 服务端环境变量

```dotenv
DAILY_BRIEF_CRON_SECRET=替换为一段足够长的随机字符串

# 可选；不配置时使用可解释的规则摘要
DAILY_BRIEF_AI_PROVIDER=openai
DAILY_BRIEF_AI_BASE_URL=https://api.openai.com/v1
DAILY_BRIEF_AI_MODEL=gpt-4.1-mini
DAILY_BRIEF_AI_API_KEY=你的服务端密钥
```

AI 密钥只能放在部署环境或本机 `.env.local`，不要放进前端设置、源码或 Git。

## GitHub Actions Secrets

- `SPARKFLOW_BRIEFING_URL`：公网部署根地址，例如 `https://example.com`
- `DAILY_BRIEF_CRON_SECRET`：与服务端同值

## 缓存位置

简报保存在 `.sparkflow/daily-brief/`，该目录已被 Git 忽略。为兼容既有存储，每天的最新小时版仍写入 `morning.json`，同时原子替换 `latest.json`，保留最近90天；页面按真实生成时间区分每小时的修订。

每个新快照会在后台准备额外 AI 摘要（已配置服务时），同一版输入跨访客复用。页面每分钟读取服务端最新缓存，整点立即检查，更新期间保留已显示内容。

行情、新闻和热力图保持各自刷新频率，所有固定公共资源启动即预热；简报详情、风险历史和曲线另有独立预加载缓存。可通过 `/api/page-preload/status` 查看覆盖情况和下次简报更新时间。首次从零启动时需要等待本机准备数据，随后访客读取共享结果。
