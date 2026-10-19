# 课程业务后端目录

本目录统一放置 CueLearn 应用源码，对应本周《业务后端改造与数据采集交付》的课程结构。原 `src/` 已整体移入 `app/desktop/`，课程 Python 模型、存储、HTTP 路由与 API 测试目前为职责骨架，由小组本周完成。

```text
app/
  __init__.py
  models.py       # 李：创建请求、读取响应、事件模型
  storage.py      # 郑：数据存取与报表查询
  main.py         # 肖：HTTP 接口与 response_model
  desktop/        # 现有完整 Electron、React 与 TypeScript 源码
    main.ts
    preload.ts
    renderer.ts
    backend/
    fronted/
    common/
tests/
  test_api.py     # 梁：成功、404、422 与统计验证
```

桌面构建入口、`@/` 别名、测试配置、样式与图片路径均指向新目录；启动命令仍从仓库根目录运行。`scripts/` 保留构建工具，`assets/`、`resources/`、`lib/`、`drizzle/` 和 `pb_migrations/` 保留原有资源与迁移位置。

现有桌面业务仍通过 Electron IPC 访问主进程和 PocketBase。Python 文件尚未接入实际请求链路，不能直接启动 HTTP 服务；本次结构迁移不等于完成课程 API 或事件采集。尚未安装 Python 框架或创建另一套数据库。

本周任务、五人分工和 PocketBase 与课程 SQL 要求的待确认事项见 [本周后端任务与分工](../project-docs/本周后端任务与分工.md)。
