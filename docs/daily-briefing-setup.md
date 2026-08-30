# 每日简报部署配置

SparkFlow 运行时会自行安排上海时间 08:00 和 18:00 的简报生成。公网部署还可以启用 `.github/workflows/daily-briefing.yml` 作为冗余触发器。

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

简报保存在 `.sparkflow/daily-brief/`，该目录已被 Git 忽略。每个日期分别保存 `morning.json` 和 `evening.json`，保留最近 90 天。

行情、新闻和热力图仍使用各自现有刷新频率；这个缓存只作用于每日文字简报和其证据快照。
