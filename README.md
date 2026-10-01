# CueLearn

CueLearn 是视频语境学习桌面应用。它保留本地视频播放、字幕、查词和片段学习能力，并增加 PocketBase 账号、基于 FSRS 的语境复习、视频学习笔记本、资料问答与测验。

## 开始使用

1. 安装 Node.js 22、Yarn 1 和 [PocketBase](https://pocketbase.io/docs/) 0.40 系列。
2. 在项目根目录启动 PocketBase：`pocketbase serve --dir pb_data --migrationsDir pb_migrations`。
3. 安装依赖并启动桌面应用：`yarn install --frozen-lockfile`，然后 `yarn start`。首次启动会执行上游资源下载。
4. 打开「语境学习」，确认 PocketBase 地址为 `http://127.0.0.1:8090`，注册或登录。首次登录可选择导入本机已有生词。

播放器中的视频和字幕文件不会上传到 PocketBase。问答和测验调用应用已有的 AI 服务设置；在「设置 → 服务与资源」填写自己的接口地址、模型和密钥。远程 PocketBase 地址由用户自行设置。

产品定位与复用路线见 [产品定位与开源复用路线](docs/product-positioning.md)；配置和演示流程见 [课程学习开发说明](docs/course-learning.md)。开源与上游同步说明见 [开源使用说明](OPEN_SOURCE_USAGE.md)。

## 开源

本项目基于 [solidSpoon 的原项目](https://github.com/solidSpoon/DashPlayer)继续开发，保留其 GNU AGPLv3 许可及原有版权信息。CueLearn 的修改也按仓库中的 [LICENSE](LICENSE) 发布。
