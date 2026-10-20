# CueLearn 本地使用说明

供本机日常启动、使用「语境学习」与课程数据采集服务。仓库根目录即本文件所在目录。

---

## 一、环境要求（一次配好）

| 工具 | 版本 / 说明 |
| --- | --- |
| Node.js | **22.x**（推荐 22.22.2+；本机可用 nvm：`nvm use 22.22.2`） |
| Yarn | 1.x（Node 自带 corepack：`corepack enable` 后 `corepack prepare yarn@1.22.22 --activate`） |
| Python / uv | Python ≥ 3.11；已装 [uv](https://docs.astral.sh/uv/) |
| PocketBase | 0.40 系列；可执行文件放在 `.local/pocketbase/pocketbase.exe`（或仓库根目录 / PATH） |

首次进入仓库：

```powershell
cd <本仓库根目录>

# Node 依赖（需 Node 22）
yarn install --frozen-lockfile

# 课程 Python API 依赖
uv sync --all-groups

# 原生资源（ffmpeg 等）；直连 GitHub 易超时，建议开代理后再跑
$env:HTTPS_PROXY = "http://127.0.0.1:7897"   # 按你本机代理端口改
$env:HTTP_PROXY  = $env:HTTPS_PROXY
yarn run download
```

若 `yarn download` 仍装不上 ffmpeg，可用代理手动下载完整 zip 后解压，把 `ffmpeg.exe`、`ffprobe.exe` 放到 `lib\`。

Electron 二进制若下载慢，启动前可设：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
```

---

## 二、每次使用：开三个终端

在仓库根目录分别开三个 PowerShell。

### 终端 1 · PocketBase（语境学习账号与云端数据）

```powershell
.\start-pocketbase.cmd
```

脚本会从 8090 起找空闲端口，并打印实际地址，例如：

`PocketBase URL: http://127.0.0.1:8091`

管理后台：`http://127.0.0.1:<端口>/_/`  
首次需在浏览器里创建超级管理员（仅后台用，不要当学习账号）。

### 终端 2 · 课程学习数据 API（事件采集与报表）

```powershell
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8011
```

| 地址 | 用途 |
| --- | --- |
| http://127.0.0.1:8011/docs | 交互式 API 文档 |
| http://127.0.0.1:8011/report | 学习统计报表页（含未参与者） |
| http://127.0.0.1:8011/reports/overview | 报表 JSON |
| `POST /events` | 行为事件采集 |

数据库文件：`learn.db`（本地生成，已 gitignore，勿提交）。

验证接口：

```powershell
uv run pytest -v
```

### 终端 3 · 桌面应用 CueLearn

```powershell
# 确认 Node 22
node --version

$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
yarn electron-forge start
```

也可：`yarn start`（会先跑 `download` 再启动，更慢）。

---

## 三、在应用里使用「语境学习」

1. 打开 CueLearn 后，左侧点 **语境学习**。
2. PocketBase 地址填终端 1 打印的 URL（例如 `http://127.0.0.1:8091`）。
3. **注册普通学习账号** 并登录（不要用 PocketBase 超级管理员当学习账号）。
4. 首次登录可按提示导入本机旧生词；本地词表不会被删。
5. 播放带字幕视频 → 查词收藏 → **生词复习**（忘记 / 模糊 / 记得）。
6. AI 问答 / 测验：在 **设置 → 服务与资源** 填写自己的接口地址、模型与密钥（仓库不含密钥）。

视频与字幕始终留在本机，不会上传到 PocketBase。

---

## 四、两套后端怎么分工

| 服务 | 端口（默认） | 存什么 | 谁在用 |
| --- | --- | --- | --- |
| PocketBase | 8090/8091… | 账号、生词、复习、笔记本等（桌面业务） | Electron「语境学习」 |
| FastAPI + SQLite | 8011 | 课程用匿名事件与统计报表 | `/docs`、`/report`、`POST /events` |

课程采集与展示说明见：`project-docs/数据采集与展示记录.md`。

上报行为示例：

```powershell
Invoke-RestMethod -Method POST "http://127.0.0.1:8011/events" -ContentType "application/json" -Body (@{
  user_key = "anon-demo-01"
  event_type = "word_lookup"
  target_type = "subtitle"
  target_id = "sha256-demo:3"
  payload = "{}"
} | ConvertTo-Json)
```

注意：只用匿名 `user_key`，不要传姓名、邮箱、密码等敏感字段。

---

## 五、常用检查与排错

| 现象 | 处理 |
| --- | --- |
| `engine "node" is incompatible` | 切到 Node 22（如 `nvm use 22.22.2`），不要用 24 |
| Electron 一直 Downloading | 设 `ELECTRON_MIRROR`，或开系统代理后再启动 |
| `yarn download` GitHub 超时 | 设 `HTTPS_PROXY` / `HTTP_PROXY` 后重试；必要时手动放 ffmpeg 到 `lib\` |
| 登录 Failed to authenticate | 在当前 PocketBase 实例上重新注册学习账号；端口变了要改应用里的地址 |
| AI 报 key invalid | 到设置里换成有效密钥与正确接口地址 |
| 报表里没有「没参与」的人 | 报表必须走 FastAPI `/report`（LEFT JOIN）；不是 PocketBase 管理页 |

健康检查：

```powershell
Invoke-RestMethod "http://127.0.0.1:8011/health"
Invoke-RestMethod "http://127.0.0.1:8091/api/health"   # 端口以 start-pocketbase 打印为准
```

---

## 六、结束使用

三个终端分别 `Ctrl+C` 停掉即可。  
不要提交：`learn.db`、`pb_data/`、密钥、本机视频与用户资料。

---

## 七、相关文档

| 文档 | 内容 |
| --- | --- |
| `README.md` | 项目总览与功能列表 |
| `docs/course-learning.md` | 课程学习功能与验收说明 |
| `project-docs/数据采集与展示记录.md` | 事件表、LEFT JOIN 报表与实测数据 |
| `app/README.md` | 课程 Python API 目录说明 |
| `docs/team-development.md` | 小组分支与 PR 协作 |
