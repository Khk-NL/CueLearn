# CueLearn 小组协作开发指南

本文供梁、郑、李、肖四位组员协作使用。产品范围和当前实现见[产品定位](product-positioning.md)与[课程学习开发说明](course-learning.md)；代码约定以仓库根目录的 [AGENTS.md](../AGENTS.md) 为准。

## 1. 分支与合并

`main` 保存已集成、可供其他组员继续开发的版本。**日常改动先从最新 `main` 建自己的分支，再发起指向 `main` 的 Pull Request（PR）**。不要在多人共用的 `main` 上同时直接开发，也不要继续把 `codex/campus-learning` 当作协作分支。

分支名说明工作内容即可，例如 `feat/review-card`、`fix/subtitle-jump`、`docs/demo-guide`。一个分支尽量完成一件事；涉及播放器和笔记本等不同模块时，先拆成可独立检查的改动。紧急的小修正若需要直接进入 `main`，也应先告知组员、完成针对性检查，并避免与正在进行的分支编辑同一片代码。

开始工作：

```bash
git switch main
git pull --ff-only origin main
git switch -c feat/your-feature
```

完成修改后，先检查 `git status` 和差异，只提交本次任务的文件。提交信息按仓库约定使用 `feat:`、`fix:`、`docs:` 等前缀；不要提交视频、字幕、PocketBase 数据目录、生成文件、密钥或本机配置。推送自己的分支后，在 GitHub 上向 `main` 提 PR：

```bash
git add -p
git commit -m "feat: describe the change"
git push -u origin feat/your-feature
```

PR 说明至少写清：改了什么、为什么改、怎样验证、尚未验证什么。界面流程变化附截图；涉及数据迁移、首次资源下载或配置步骤的变化，写明组员更新本地环境时要做什么。请另一位组员查看主要流程与差异后再合并。合并后，下一项工作从更新后的 `main` 新建分支，不在已合并分支继续累积无关功能。

如果开发期间 `main` 已更新，先提交或妥善保存自己的修改，再运行 `git fetch origin`、`git merge origin/main`，解决冲突并重新检查受影响功能。不要用强制推送覆盖别人共用的分支。发生冲突时，核对双方意图；播放器、学习服务和 README 的冲突尤其需要同时保留有效功能、来源署名与配置说明。

## 2. 代码位置与职责

| 工作 | 主要位置 | 协作提醒 |
| --- | --- | --- |
| 播放、字幕、时间跳转 | `src/fronted/features/player/`、`src/backend/services/WatchHistoryService.ts` | 保留原有本地播放和字幕行为，新增学习入口时检查从出处返回播放器。 |
| 学习页面与复习卡片 | `src/fronted/features/learning/` | 用户文案同时更新 `src/fronted/i18n/locales/zh-CN/` 与 `en-US/`。 |
| 生词、FSRS、笔记本业务 | `src/backend/services/LearningService.ts`、`src/backend/services/learning/` | 从主进程访问 PocketBase；复习作答记录是排程事实来源。 |
| PocketBase 与本机媒体映射 | `src/backend/infrastructure/learning/`、`pb_migrations/` | 用户数据按账号隔离；视频留本机，服务端只存媒体标识和必要出处。 |
| IPC 契约 | `src/backend/controllers/LearningController.ts`、`src/common/api/api-def.ts` | 新业务调用同时更新契约、主进程路由和前端 API。 |
| 运行与开源说明 | `README.md`、`docs/`、`OPEN_SOURCE_USAGE.md` | 功能状态以实际代码和验证为准；保留上游及第三方版权许可信息。 |

沿用 React 界面 → Electron IPC → 主进程服务 → 本地文件或 PocketBase 的分层。新增功能前先找现有播放、字幕解析、AI 配置、并发控制和翻译能力，能复用就不要再建一套。不要把 PocketBase 令牌、视频绝对路径或服务密钥传给渲染进程或提交到仓库。更详细的文件摆放规则见[架构指南](architecture-guidelines.md)。

## 3. 本机启动与共同配置

使用项目 `package.json` 约定的 Node.js 22 和 Yarn 1。安装依赖后运行 `yarn start`。Windows 下运行仓库根目录的 `start-pocketbase.cmd` 启动 PocketBase；它会选择空闲端口，组员应把脚本显示的地址填入应用「语境学习」页。首次启动会应用 `pb_migrations/`，不要把本机 `pb_data/` 推送到仓库。

每人使用自己的普通学习账号测试。PocketBase 管理后台账号不用于应用登录。AI 问答和测验需要个人在应用「设置 → 服务与资源」填写可用服务；远程 PocketBase 与 AI 接口由组长统一确定后再配置，不能把地址、密钥或真实用户数据写进代码、截图和 PR。没有 AI 服务时，可先检查资料选择、字幕读取及错误提示，并在 PR 中注明真实回答尚未验证。

## 4. 提交前检查

先做与改动直接相关的验证，再按需运行完整检查：

```bash
node_modules/.bin/tsc --noEmit
yarn lint
yarn test:run
```

Windows 可使用 `node_modules\.bin\tsc.cmd --noEmit`。完整 lint 和测试目前存在已记录的既有失败；PR 中写出本次运行的实际结果，不能把“未新增失败”写成“全部通过”。测试约定见[测试指南](testing-guidelines.md)，桌面端完整流程见[e2e 指南](e2e-testing.md)。课程验收重点是“观看 → 收藏 → 复习 → 笔记本问答 → 点击出处回跳”，并检查账号切换、重复收藏、断网和本机文件缺失时的行为。

每次更新对外功能，同步修改对应文档。只把亲自运行并看到结果的步骤列为“已验证”；远程服务尚未配置时明确写“待验证”。

## 5. 分工与同步

当前分工见[开发方案确认单](../project-docs/开发方案确认单.md)。各模块负责人可以在自己的分支独立实现，但共用的 IPC 契约、数据库集合和导航入口应尽早在 PR 说明里告知其他组员。每周同步进度时核对：正在做的分支、待评审 PR、可演示流程、阻碍与下一步负责人。

GitHub 是当前开发仓库。Gitee 地址尚未提供；创建后再记录实际远程地址和同步办法，不猜测目标。期末提交材料应与 `main` 的代码和验证记录保持一致。
