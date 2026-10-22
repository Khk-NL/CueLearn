# 课程业务后端目录

本目录统一放置 CueLearn 应用源码，对应本周《业务后端改造与数据采集交付》的课程结构。原 `src/` 已整体移入 `app/desktop/`；根目录 Python 文件提供独立的本机课程 API，桌面端继续使用 Electron IPC 与 PocketBase。

```text
app/
  __init__.py
  models.py       # Create / Response 与匿名事件模型
  storage.py      # SQLite 存取；报表用 LEFT JOIN
  main.py         # FastAPI 路由（含 POST /events、/report）
  desktop/        # Electron、React 与 TypeScript 源码
tests/
  test_api.py     # 成功、404、422 与零参与者统计
```

## 课程学习数据 API

```powershell
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8011
uv run pytest -v
```

- 文档：http://127.0.0.1:8011/docs
- 报表页：http://127.0.0.1:8011/report
- 统计 JSON：`GET /reports/overview` 或 `GET /report/data`
- 行为采集：`POST /events` → 表 `learning_events`（匿名 `user_key`，不采姓名）
- 数据库固定在仓库根目录 `learn.db`，已在 `.gitignore`
- 测试使用临时 SQLite 与应用生命周期，不清空本机演示库；实际测试结果见本轮交付记录

本服务没有鉴权，只用于可信本机演示，不能作为公网账号后端。它不替代或同步 PocketBase，也不会自动把桌面端收藏、复习操作转发到 `/events`。课程固定间隔统计不等于桌面 FSRS 排程。

真实接口、错误格式、匿名数据约束和统计口径见[课程接口说明](../docs/course-api.md)。梁负责 API 成功、404、422及统计验证，肖负责接口，李负责模型，郑负责存储与报表，严负责桌面采集联调；分工见[本周后端任务与分工](../project-docs/本周后端任务与分工.md)。
