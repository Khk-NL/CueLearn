# Windows 桌面启动说明

## 本机打开

双击仓库根目录 `start-cuelearn.cmd`，等待资源检查与Vite构建，随后打开CueLearn窗口。首次使用会显示保存位置引导，完成后进入主界面；左侧「语境学习」为账号、复习和笔记本入口。

此入口打开的是Electron中的原有React前端。课程独立HTML原型请打开 `prototype-learning.html`，二者用途不同。

启动器会打印实际Node与Yarn位置；选择当前PATH中受支持的Node22，或本机已经放在 `.local/node22/node-*/` 的Node22。不会下载Node或修改系统PATH。若只有Node24，请先安装或切换至Node22。Yarn须为Classic1.x；使用Corepack时，先准备项目锁定版本：

```powershell
corepack prepare yarn@1.22.22 --activate
```

首次安装依赖需运行 `yarn install --frozen-lockfile`；不要将 `--ignore-scripts` 安装视为运行环境已经准备好。若Electron程序缺失，启动器会执行锁定版本自身的 `install.js`，优先使用缓存。原生模块仍交给Electron Forge正常编译，不关闭重建或用Node版本二进制冒充Electron版本。

## 本次实际故障与修复（2026-10-22）

| 故障 | 证据与处理 |
| --- | --- |
| Node版本冲突 | 默认Node24.21.0不满足项目22.x；本机 `yarn.cmd` 固定调用相邻Node，单改PATH仍失败。启动器直接用选定Node22执行Yarn的JS入口 |
| Electron未安装 | `node_modules/electron/dist/electron.exe` 原本不存在；从本机缓存安装44.2.0成功 |
| SQLite原生模块缺失 | better-sqlite3 12.11.1针对Electron ABI149的官方预编译包返回404，需本机编译 |
| SDK路径异常 | MSBuild报MSB8036，实际SDK位于D盘，但解析出的SDK路径为空或根目录；26100工具目录另缺rc.exe。使用完整22621 SDK的头文件、库与工具显式完成编译 |

本机SDK修复参数位于被忽略的 `.local/windows-sdk.props`，只作用于启动进程。启动器若发现此文件会明确打印并传给MSBuild，不修改注册表、Visual Studio文件或仓库的跨平台构建配置。该文件含本机绝对路径，不提交，也不适合直接发给其他组员。其他电脑应通过Visual Studio Installer正确安装或修复「使用C++的桌面开发」及完整Windows SDK；不要照抄D盘路径。

启动器的PowerShell源文件使用UTF-8 BOM，以兼容Windows PowerShell5.1读取中文注释。不要改为无BOM后仍以系统PowerShell5.1执行。

## 验证范围

已完成Electron安装、better-sqlite3真实编译，并在独立临时资料目录中启动真实Electron程序。验证过首次使用页及完成引导后的主界面，窗口标题为CueLearn，导航包含收藏片段、视频字幕生成、词汇工坊、语境学习与设置中心；已保存本机验证截图。

随后使用新增启动器实际执行完整 `yarn start` 链路，资源检查、Forge、Vite及数据库初始化完成，日志出现 `app ready` 与 `main window created`，实际进程窗口标题为CueLearn。验证时桌面应用已保持打开，使用者可直接查看。

这项验证说明桌面窗口能启动，不代表PocketBase、AI、媒体识别引擎和完整学习流程均已通过。资源检查仍提示whisper.cpp缺少cmake，尚未完成该引擎的本机源码构建；不要将此提示记为已修复。现有sherpa-onnx资源检查通过。

退出开发模式时，在启动终端按Ctrl+C并关闭应用窗口。不要重复启动多个开发进程；需要换端口或再次启动时，先确认上一实例已经退出。
