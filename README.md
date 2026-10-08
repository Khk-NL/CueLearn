# CueLearn

CueLearn 是面向本机视频的学习桌面应用。用户可以边看视频边查词、收藏带原句和时间点的生词，再按间隔复习；也可以把带字幕的视频加入学习笔记本，生成摘要、提问和测验，并从引用跳回视频核对内容。

项目由梁、郑、李、肖组成的课程小组开发。现有播放器、字幕和本地媒体能力基于 [DashPlayer](https://github.com/solidSpoon/DashPlayer)；CueLearn 在此基础上加入学习账号、语境复习与视频笔记本。项目以 [GNU AGPLv3](LICENSE) 发布，来源和第三方资源说明见 [开源使用说明](OPEN_SOURCE_USAGE.md)。

## 已实现的功能

- 本地视频播放、字幕显示与跳转、查词和本地收藏。
- PocketBase 账号与按用户隔离的生词、复习记录、笔记本和测验数据。首次登录可选择导入本地词表；本地原数据保留。
- 记录收藏时的字幕原句、视频指纹和时间点；从复习卡片播放原声语境。复习排程使用 `ts-fsrs`，从每次作答记录重建到期时间。
- 为笔记本选择带字幕的视频；对所选资料提问、生成摘要和四选一测验，保存手写笔记。回答及题目带可点击的字幕出处。

视频与字幕文件始终留在本机。PocketBase 保存媒体指纹和必要的引用信息；换设备后需要重新关联本机视频。AI 功能需要使用者自行配置可用的模型服务，仓库不包含远程地址或密钥。

## 开始使用

1. 安装 Node.js 22、Yarn 1 和 [PocketBase](https://pocketbase.io/docs/) 0.40 系列。
2. Windows 下可将 `pocketbase.exe` 放在仓库根目录或 `.local/pocketbase/`，运行 `start-pocketbase.cmd`。脚本从 8090 起自动选择空闲端口，显示实际服务地址，并使用仓库的 `pb_migrations/`。
3. 运行 `yarn install --frozen-lockfile` 和 `yarn start`。首次启动会执行原项目的资源下载脚本。
4. 打开「语境学习」，将 PocketBase 地址设为脚本显示的地址，注册普通学习账号或登录。PocketBase 管理员账号只用于管理后台。首次登录可选择导入本机已有生词。

播放器中的视频和字幕文件不会上传到 PocketBase。问答和测验调用应用已有的 AI 服务设置；在「设置 → 服务与资源」填写自己的接口地址、模型和密钥。远程 PocketBase 地址由用户自行设置。

产品定位与复用路线见 [产品定位与开源复用路线](docs/product-positioning.md)；配置、演示流程及验证状态见 [课程学习开发说明](docs/course-learning.md)。开源与上游同步说明见 [开源使用说明](OPEN_SOURCE_USAGE.md)。

小组成员从 `main` 创建功能分支并通过 PR 协作，具体步骤见 [小组协作开发指南](docs/team-development.md)。

## 开发检查

应用沿用 React → Electron IPC → 主进程服务的分层。常用检查命令为 `node_modules\.bin\tsc.cmd --noEmit`、`yarn lint` 和 `yarn test:run`。远程 PocketBase 与 AI 服务尚待使用者配置，不能视作已经过实机验收。

## 开源

本项目基于 [solidSpoon 的原项目](https://github.com/solidSpoon/DashPlayer)继续开发，保留其 GNU AGPLv3 许可及原有版权信息。CueLearn 的修改也按仓库中的 [LICENSE](LICENSE) 发布。

内置离线词典数据基于 [ECDICT](https://github.com/skywind3000/ECDICT) 常用词子集构建，ECDICT 采用 MIT 许可；复习排程使用 MIT 许可的 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)。具体来源与使用要求见 [开源使用说明](OPEN_SOURCE_USAGE.md)。
