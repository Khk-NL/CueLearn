# 课程业务后端目录

本目录统一放置 CueLearn 应用源码，对应《业务后端改造与数据采集交付》的课程结构。原 `src/` 已整体移入 `app/desktop/`。Python 课程服务现提供匿名参与者、复习事件与统计接口；启动方法、请求响应与实际验收范围见 [课程接口说明](../docs/course-api.md)。

```text
app/
  __init__.py
  models.py       # 创建请求、读取响应、事件和统计模型
  storage.py      # 独立课程 SQLite 事件存储与 LEFT JOIN 报表
  main.py         # 六个 HTTP 业务接口与显式 response_model
  desktop/        # 现有完整 Electron、React 与 TypeScript 源码
    main.ts
    preload.ts
    renderer.ts
    backend/
    fronted/
    common/
tests/
  test_api.py     # 成功、404、422、去重、持久化与零参与者验证
```

桌面构建入口、`@/` 别名、测试配置、样式与图片路径均指向新目录；启动命令仍从仓库根目录运行。`scripts/` 保留构建工具，`assets/`、`resources/`、`lib/`、`drizzle/` 和 `pb_migrations/` 保留原有资源与迁移位置。

现有桌面业务仍通过 Electron IPC 访问主进程和 PocketBase。Python 服务按本次任务明确授权的边界，独立保存匿名学习事件，不复制账号、词条或 FSRS 排程。它默认仅用于本机课程演示，尚未接入桌面端真实操作采集；不能将 HTTP 联调通过写成桌面端已联调。匿名标识不提供登录或权限认证。

原始分工和待确认事项见 [本周后端任务与分工](../project-docs/本周后端任务与分工.md)。本次实现边界并不代表全组此前已确认的最终集成方案。
