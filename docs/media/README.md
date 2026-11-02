# SparkFlow 介绍素材

- `sparkflow-intro.mp4`：44 秒，1920×1080 / 60 fps，H.264 + AAC，中文合成解说、烧录字幕、原创配乐与界面音效。
- [Releases 中的 `sparkflow-intro.gif`](https://github.com/XiaoyeCodes/SparkFlow/releases/download/readme-demo-2026-11-02/sparkflow-intro.gif)：README 当前使用的完整 44 秒无声循环动图，960×540、20 fps、880 帧，约 18.27 MB。保留全部场景、原始播放时长和烧录字幕，未剪成短预览。GIF 托管在 Releases，不加入 Git 历史。
- `sparkflow-preview-hd.webp`：旧版 8 秒、1600×900、30 fps 无声预览，约 3.29 MB，保留兼容旧链接，README 已不再加载。
- `sparkflow-preview.gif`：旧版 800×450、12 fps 预览，保留兼容旧链接，README 已不再加载。
- `sparkflow-poster.webp`：片尾品牌封面。
- `sparkflow-zh.srt`：独立中文字幕。

完整 MP4 与独立字幕也随 [README 演示素材 Release](https://github.com/XiaoyeCodes/SparkFlow/releases/tag/readme-demo-2026-11-02) 发布。MP4 直接使用仓库中的原始文件，不重新编码；1080p60 指高清原片，GIF 的参数如上。

制作采用 huashu-motion。产品画面录自当前项目本地浏览器，录制日期 2026-10-29；行情和新闻只代表录制时点的页面展示。研究过程与报告展示为明确标注的流程示意，没有发起新的模型研究请求。公开素材未使用账户页面、历史研究列表或模型配置。

可编辑交付包含 HTML/GSAP、选定录屏、字体、音频和运行工具。原始浏览检查材料不属于公开交付。

## 重新生成 README 完整动图

在仓库根目录运行（需要 Python 与 FFmpeg）：

```powershell
python scripts/generate-intro-gif.py
```

默认输出到已被 Git 忽略的 `tmp/sparkflow-intro.gif`，可用 `--output` 指定路径，用 `--ffmpeg` 指定 FFmpeg。覆盖已有文件需要 `--overwrite`。

脚本直接读取完整 MP4，以 Lanczos 缩放、128 色全片调色板、无抖动量化和局部帧差分控制体积；20 fps 对应固定 50 ms 帧间隔，无限循环。动图首次下载耗时取决于网络；需要细看界面小字或收听解说时，可打开高清原片。README 对减少动态效果的系统偏好使用静态封面。

旧的 `scripts/generate-intro-preview.py` 仍可生成此前的 8 秒 WebP，但不用于当前 README。
