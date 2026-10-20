# 课程业务后端目录

本目录统一放置 CueLearn 应用源码，对应本周《业务后端改造与数据采集交付》的课程结构。原 `src/` 已整体移入 `app/desktop/`；课程 Python API（生词 / 复习 / 行为事件 / 报表）已可本地运行。

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
uv sync --all-groups
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8011
uv run pytest -v
```

- 文档：http://127.0.0.1:8011/docs
- 报表页：http://127.0.0.1:8011/report
- 行为采集：`POST /events` → 表 `learning_events`（匿名 `user_key`，不采姓名）
- 数据库文件 `learn.db` 本地生成，已在 `.gitignore`

桌面应用仍通过 Electron IPC 与 PocketBase；本 Python 服务独立承载课程要求的落库、采集与统计展示。分工见 [本周后端任务与分工](../project-docs/本周后端任务与分工.md)。
