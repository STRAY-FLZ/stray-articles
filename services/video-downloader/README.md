# Stray 视频下载服务

前端：[个人网站的视频工具](https://stray-flz.github.io/stray-articles/tools/video/)。源文件在 `tools/video/`。**已接入用户确认的 Render 免费试用服务**：[服务状态](https://stray-video-api.onrender.com/v1/health)。配置只包含公开服务地址，不包含账号、Cookie 或密钥。页面等待休眠后的启动并自动重试；清晰度和文件限制来自实际服务响应。

## 已实现

- 解析哔哩哔哩、抖音、小红书单条视频网页及短链接；保留小红书分享校验参数，支持抖音 `modal_id` 页面和 B站分P参数。
- 从解析结果列出实际分辨率，横屏与竖屏均标注尺寸；相同尺寸优先 H.264。只有一个档位时只显示一个选项。
- 完整视频、仅音轨、音画分离。独立音轨可保留原始编码，或转换为 192 kbps MP3。视频合并和分离不重新编码。
- SQLite 任务保存、受限工作队列、进度、取消、刷新恢复、结果自动过期、按浏览器会话隔离的任务、短时签名文件下载。
- 每次解析/下载运行在独立子进程中。网络经本地出口代理：检查所有连接的 DNS 结果、拒绝私网/保留地址并直接连接已检查的 IP，覆盖短链接、重定向和媒体请求。HTTPS 保留端到端证书校验。FFmpeg 仅处理本地文件。

## 部署选择

| 方式 | 用途 | 注意事项 |
| --- | --- | --- |
| Render 免费实例 | 先试用短视频，无需自备域名 | 本配置单任务最大 128 MB、单工作进程，结果最多暂存 15 分钟。服务休眠/重启会丢失任务和结果，可能冷启动约一分钟。平台对出站流量有限制，不适合作为稳定的公共下载服务。 |
| Render 付费实例 + 持久磁盘 | 希望少管理服务器 | 选择满足处理任务的内存，挂载磁盘到 `/data`，仍保持一个 API 实例和一个 Uvicorn 进程。计算、磁盘和流量以控制台当日报价为准。 |
| Linux 云服务器 + Docker Compose | 正式使用、控制运维与存储 | 建议从 2 核、2–4 GB 内存、足够的月流量额度起步。这是本项目的容量建议，不是云厂商报价；需为 API 配置可签发 HTTPS 证书的域名。 |

官方说明：[Render 免费限制](https://render.com/docs/free)、[Render 价格](https://render.com/pricing)、[Render 持久存储](https://render.com/docs/disks)。服务器地区和源站的可访问性需要用实际链接验证；拥有公开链接也不能保证数据中心 IP 能访问源站。

## Render 先试用

1. 登录 Render，使用 [本仓库的部署入口](https://render.com/deploy?repo=https://github.com/STRAY-FLZ/stray-articles) 创建 Blueprint。仓库根目录的 `render.yaml` 已配置 Docker 构建和健康检查。创建实例和连接你的账户需要你在 Render 完成。
2. 服务运行后，打开 `https://你的服务.onrender.com/v1/health`，应返回 `status: ready`。
3. 把 `tools/video/config.js` 的 `apiBase` 改为该 HTTPS 地址，不带 `/v1`，提交到网站 `main` 分支。
4. 用你拥有或获许可的三个平台视频分别验收解析、可用清晰度、完整视频、原始音轨、MP3、音画分离、刷新恢复和下载。
5. 验收通过后再更新工具列表中的启用状态。免费实例不能保证“暂存 15 分钟”期间结果一定保留，重启会提前删除。

免费方案不存在预置的第三方解析 API，也不把所有访问者的任务交给其他下载站。

## 云服务器部署

在本目录执行：

```sh
cp .env.example .env
# 修改 VIDEO_API_DOMAIN，例如 video.example.com；将域名的 A 记录指向服务器。
# 允许服务器入站 TCP 80/443；不要将 API 的 8080 端口开放到公网。
docker compose up -d --build
```

Caddy 会为该域名提供 HTTPS。持久数据在 `video-data` Docker 卷；源站 cookie 目录为 `cookies/`，以只读方式挂载。容器非 root 运行，API 文件系统只读，工作目录单独可写。每次更新解析器需重建并完成实链验收。

Compose 的固定内网代理 IP 用于可信 `X-Real-IP`，避免将访问者伪造的转发头作为限流地址。如果改网络地址，同时更新 `VIDEO_TRUSTED_PROXY`；云托管默认不信任任何转发头。

## 登录与平台限制

**解析器支持某个平台，不代表所有链接当前都能成功。** 抖音可能要求更新的验证 cookie；小红书通常需要包含有效 `xsec_token` 的完整分享链接；B站部分清晰度会受账号权限影响。工具不会解锁付费视频、解密 DRM，也不自动处理验证码。

需要源站验证时，管理员可在自己的合法授权范围内配置 Netscape cookie 文件 `bilibili.txt`、`douyin.txt`、`xiaohongshu.txt`，放入服务器的 `cookies/`。Render 可使用 Dashboard Secret Files 并将 `VIDEO_COOKIE_DIR` 配置为 `/etc/secrets`。不要将这些文件提交到 GitHub、放入前端、发送给访问者或用于给公众共享付费权限。

默认解析器版本固定为 `yt-dlp 2026.8.19`。源站变化导致失败时，在 `requirements.txt` 选择并验证新版；不要仅凭仓库支持列表宣布实链可用。

## 本地验证

Python 3.12、FFmpeg 与 FFprobe 可用时：

```sh
python -m venv .venv
# 激活虚拟环境后：
pip install -r requirements-dev.txt
pytest -q
VIDEO_DATA_DIR=./data VIDEO_ALLOWED_ORIGINS=http://127.0.0.1:4173 \
  python -m uvicorn app:app --host 127.0.0.1 --port 8080 --no-access-log
```

测试含真实生成的媒体文件：检查完整视频同时具有画面和声音，分离视频不含音轨，独立音频不含画面，原始 AAC 编码得以保留，MP3 输出确实为 MP3。API 测试使用隔离夹具，不作为三个平台实链成功的证据。

2026-10-06 本地实链结果：B站公开样例能列出 1080P、720P、480P、360P；实际取得 360P 并完成音画分离、签名链接下载，FFprobe 验证两个文件分别只有视频流和音频流。抖音样例要求更新验证信息；两个小红书样例未返回视频格式，包括开源解析器里的完整分享链接。未宣称后两者实链验收通过，需在部署环境中使用当前有效分享链接或合法配置源站验证信息继续验收。

2026-10-06 Render 实链结果：健康检查、网站来源的 CORS 预检和带会话令牌请求通过。B站同一样例仍有四档清晰度；选择 360P、音画分离和 MP3 后，处理约 108 秒完成，实际签名链接下载两个文件。FFprobe 确认 24,511,111 字节的 H.264 文件只有画面，13,300,734 字节的 MP3 文件只有音频。抖音样例仍要求验证信息；小红书完整分享样例仍未返回格式，后两者尚未完成成功下载验收。免费实例性能较低，解析成功后仍需等待媒体处理。

默认限制：单视频 30 分钟；单输出 512 MB；两工作进程；最多 12 个在途任务、每浏览器 2 个；全服务每日最多 100 次通过参数验证的下载提交；结果完成后暂存 60 分钟；签名下载链接有效期最多 15 分钟；临时数据总量 4 GB。超时、超量、取消和失败都会清理工作目录。前端定期更新文件链接与过期状态。

## API

浏览器生成 32 字节随机会话令牌，用 `Authorization: Bearer <64位hex>` 访问任务接口；服务保存令牌的哈希。该令牌只是匿名任务归属，不是站点管理员账号。CORS 限定网站来源，配合 IP / 会话 / 全局限流；CORS 不是阻止所有第三方调用的认证机制。

- `GET /v1/health`：处理程序是否就绪、保留时间、文件限制。
- `POST /v1/analyze`：`{"url":"视频分享链接"}`，返回解析 ID、标题、实际可用档位。
- `POST /v1/jobs`：`{"analysis_id":"...","quality_id":"q1","mode":"split","audio_format":"original"}`。
- `GET /v1/jobs/{id}`：状态与签名文件链接，不返回源站媒体 URL、Cookie 或内部路径。
- `DELETE /v1/jobs/{id}`：取消在途任务。
- `GET /v1/jobs/{id}/files/{key}?expires=...&signature=...`：仅凭限定该文件的签名下载；可用浏览器普通下载与续传。

## 开源依赖

自有页面沿用 Stray 的共享主题。后端通过 Python API 使用 [yt-dlp](https://github.com/yt-dlp/yt-dlp)（项目源码 Unlicense）、[FastAPI](https://github.com/fastapi/fastapi)（MIT）、[Uvicorn](https://github.com/encode/uvicorn)（BSD-3-Clause）和系统 [FFmpeg](https://ffmpeg.org/legal.html)（具体许可证取决于构建组件）。没有复制 Cobalt、MeTube 等项目的前端代码。若对外分发容器/二进制，请保留实际构建依赖的许可证与相应源码义务。
