# SparkFlow 介绍素材

- `sparkflow-intro.mp4`：44 秒，1920×1080 / 60 fps，H.264 + AAC，中文合成解说、烧录字幕、原创配乐与界面音效。
- `sparkflow-preview-hd.webp`：8 秒、1600×900、30 fps（帧间隔 33 / 34 ms）的 README 高清无声预览，点击跳转完整视频；约 3.29 MB。
- `sparkflow-preview.gif`：旧版 800×450、12 fps 预览，保留兼容旧链接，README 已不再加载。
- `sparkflow-poster.webp`：片尾品牌封面。
- `sparkflow-zh.srt`：独立中文字幕。

制作采用 huashu-motion。产品画面录自当前项目本地浏览器，录制日期 2026-10-29；行情和新闻只代表录制时点的页面展示。研究过程与报告展示为明确标注的流程示意，没有发起新的模型研究请求。公开素材未使用账户页面、历史研究列表或模型配置。

可编辑交付包含 HTML/GSAP、选定录屏、字体、音频和运行工具。原始浏览检查材料不属于公开交付。

## 重新生成 README 预览

在仓库根目录运行（需要 Python 与 FFmpeg）：

```powershell
python scripts/generate-intro-preview.py
```

脚本直接读取完整 MP4，截取宏观、热力图、新闻和品牌片尾各 2 秒，以动态 WebP 编码。高清预览不经过旧 GIF 的缩放和调色板压缩。README 对减少动态效果的系统偏好及不支持 WebP 的浏览器使用静态封面。
