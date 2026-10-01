# CueLearn 开源使用说明

## 项目与来源

CueLearn 基于 [solidSpoon/DashPlayer](https://github.com/solidSpoon/DashPlayer) 的代码开发。现有视频播放、字幕与本地学习基础来自上游；本仓库新增 PocketBase 账号、生词语境复习和学习笔记本等课程功能。仓库独立维护，不代表上游项目发布或支持。

其他项目的复用评估与当前集成状态见[产品定位与开源复用路线](docs/product-positioning.md)。目前没有把 Open Notebook、ts-fsrs、Anki 或 OpenKoto 的代码纳入仓库；将来实际引入时，按具体版本和文件补充来源、修改与许可记录。

项目沿用仓库中的 [GNU AGPLv3 许可证](LICENSE)。分发修改后的程序时应保留许可证、原有版权信息及修改说明，并向接收者提供对应源代码；提供经修改的网络服务时，还需注意 AGPLv3 关于网络交互的条款。具体权利义务以 [GNU AGPLv3 原文](https://www.gnu.org/licenses/agpl-3.0.en.html)为准。

## 获取、运行和配置

- 源代码仓库：[Khk-NL/CueLearn](https://github.com/Khk-NL/CueLearn)。
- 开发环境：Node.js 22、Yarn 1、PocketBase 0.40 系列。
- 在仓库根目录运行 `pocketbase serve --dir pb_data --migrationsDir pb_migrations`；首次启动会应用 `pb_migrations/` 中的集合定义。
- 运行 `yarn install --frozen-lockfile` 和 `yarn start`。原项目的 `start` 脚本会先执行资源下载，首次运行所需时间取决于网络和资源大小。
- 在应用「语境学习」页面设置 PocketBase 地址，默认本机地址为 `http://127.0.0.1:8090`；公开部署时使用 HTTPS。AI 问答沿用应用内「服务与资源」设置，不附带第三方服务密钥。
- `pb_data/`、`.local/`、用户视频、字幕、账户资料和生成内容不应提交到仓库。

## 数据与隐私

PocketBase 保存账号、生词、复习事件、笔记本、笔记和测验。集合规则按账号限制读写。本机视频和字幕文件保持在设备上；服务端只保存媒体指纹、标题和必要的字幕引用。切换设备后，需要在新设备重新选择对应视频，才能跳转出处。登录令牌只保存在桌面应用主进程内存中，重启后重新登录。

从上游桌面应用转到 CueLearn 时，首次启动会复制可用的本地配置和数据库，保留旧目录；原本保存在文档目录的视频学习文件仍按既有路径访问。

## 与上游同步

本仓库可把原项目作为单独的 `upstream` 远程：

```bash
git remote add upstream https://github.com/solidSpoon/DashPlayer.git
git fetch upstream
```

合并前在独立分支检查上游改动。课程功能主要位于 `src/backend/services/LearningService.ts`、`src/backend/infrastructure/learning/`、`src/fronted/features/learning/`、`src/common/contracts/learning.ts` 和 `pb_migrations/`；接入点集中在路由、IoC、收藏按钮和导航中。品牌与发行配置有少量专门修改，更新上游时重点检查这些冲突。不要将上游发布地址和 CueLearn 的更新地址混用。

## 资源与第三方服务

上游内置资源、图标、模型下载地址和第三方依赖可能各有许可或使用条款。重新分发安装包前，应核对随包资源的来源与许可。PocketBase 可执行文件、用户配置的 AI 模型及密钥不包含在本仓库中。
