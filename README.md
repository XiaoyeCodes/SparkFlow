# SparkFlow

星流个人研究工作台，包含市场情报、新闻聚合、AI 深度研究与 Obsidian 导出。

## 本地启动

准备以下运行环境：

- Node.js 20+
- Python 3.11+ 或 [uv](https://docs.astral.sh/uv/)

克隆仓库后，双击 `start-sparkflow.bat`。脚本会自动：

1. 按 `package-lock.json` 安装前端依赖。
2. 按内置锁文件创建 `services/vibe-trading/.venv` 并安装研究引擎。
3. 从 5173 开始寻找可用端口并启动 SparkFlow。
4. 在 8899-8999 中选择可用端口启动内置研究服务。

首次启动需要下载依赖，可能耗时数分钟；之后会通过依赖哈希直接跳过。停止项目请双击 `stop-sparkflow.bat`。

## AI 设置

打开页面右上角头像，进入“设置”，选择 OpenAI、智谱、DeepSeek、通义千问或自定义接口，并填写 API Key 与模型名称。密钥仅写入本机忽略文件，不会进入 Git。

AI 深度研究源码已随仓库内置，不依赖其他本地项目。相关上游许可与说明见 `services/vibe-trading/LICENSE`、`NOTICE` 和 `README.md`。
