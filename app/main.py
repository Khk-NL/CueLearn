"""
CueLearn 视频语境学习系统 · 学习数据后端。

只做核心学习数据：收藏生词及语境、提交复习、上报行为、查看统计。
视频播放、ASR、AI 问答、账号认证、教师端不在这里。
数据在 SQLite（learn.db），用来模拟尚未配置的 PocketBase 集合。

    uv run fastapi dev app/main.py
    uv run pytest -v
"""

from contextlib import asynccontextmanager
from datetime import datetime
from html import escape

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.responses import HTMLResponse

from app import storage
from app.models import (
    USER_KEY_PATTERN,
    HealthResponse,
    LearningEventCreate,
    LearningEventResponse,
    MessageResponse,
    OverviewReport,
    ReviewEventCreate,
    ReviewEventList,
    ReviewEventResponse,
    RootResponse,
    VocabularyItemCreate,
    VocabularyItemResponse,
)
from app.storage import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="CueLearn 学习数据服务",
    description=(
        "CueLearn 视频语境学习系统。SQLite 模拟 PocketBase 上的生词、复习与行为事件。"
        "行为采集不接收真实姓名、邮箱、密码等敏感信息。"
    ),
    version="0.3.0",
    lifespan=lifespan,
)


@app.get("/", tags=["系统"], summary="服务首页", response_model=RootResponse)
def read_root():
    """说明文档和报表的位置。"""
    return {
        "message": "CueLearn 学习数据服务",
        "docs": "/docs",
        "report": "/report",
    }


@app.get("/health", tags=["系统"], summary="健康检查", response_model=HealthResponse)
def health_check():
    return {"status": "ok"}


@app.delete(
    "/admin/reset",
    tags=["系统"],
    summary="清空学习数据（仅供本地演示和测试）",
    response_model=MessageResponse,
)
def admin_reset():
    """无鉴权，不能部署到公网。"""
    storage.reset_db()
    return {"message": "数据已清空"}


@app.post(
    "/vocabulary_items",
    tags=["生词"],
    summary="收藏生词及语境",
    status_code=status.HTTP_201_CREATED,
    response_model=VocabularyItemResponse,
)
def create_vocabulary_item(payload: VocabularyItemCreate):
    """对应确认单 learning/word/save。同一用户重复单词只追加语境。"""
    return storage.save_vocabulary_item(
        user_key=payload.user_key,
        word=payload.word,
        definition=payload.definition,
        contexts=[ctx.model_dump() for ctx in payload.contexts],
    )


@app.get(
    "/vocabulary_items/{vocabulary_item_id}",
    tags=["生词"],
    summary="查询词条及其语境",
    response_model=VocabularyItemResponse,
)
def get_vocabulary_item(vocabulary_item_id: int):
    item = storage.get_vocabulary_item(vocabulary_item_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"词条 {vocabulary_item_id} 不存在")
    return item


@app.post(
    "/review_events",
    tags=["复习"],
    summary="提交复习评分",
    status_code=status.HTTP_201_CREATED,
    response_model=ReviewEventResponse,
)
def create_review_event(payload: ReviewEventCreate):
    """对应确认单 learning/review。词条不存在或不属于该用户时 404。"""
    saved = storage.insert_review_event(
        user_key=payload.user_key,
        vocabulary_item_id=payload.vocabulary_item_id,
        rating=payload.rating.value,
        duration_ms=payload.duration_ms,
    )
    if saved is None:
        raise HTTPException(
            status_code=404,
            detail=f"词条 {payload.vocabulary_item_id} 不存在",
        )
    return saved


@app.get(
    "/review_events",
    tags=["复习"],
    summary="按用户查询复习记录",
    response_model=ReviewEventList,
)
def list_review_events(
    user_key: str = Query(min_length=1, max_length=64, pattern=USER_KEY_PATTERN),
):
    """没有记录时返回空列表，而不是 404。"""
    items = storage.list_review_events(user_key)
    return {"user_key": user_key, "count": len(items), "items": items}


@app.post(
    "/events",
    tags=["行为采集"],
    summary="上报一条学习行为",
    status_code=status.HTTP_201_CREATED,
    response_model=LearningEventResponse,
)
def create_learning_event(payload: LearningEventCreate):
    """谁、何时、对什么、做了什么。不接收真实姓名和账号。"""
    return storage.insert_learning_event(
        user_key=payload.user_key,
        event_type=payload.event_type.value,
        target_type=payload.target_type.value,
        target_id=payload.target_id,
        payload=payload.payload,
    )


@app.get(
    "/reports/overview",
    tags=["数据展示"],
    summary="学习统计报表（JSON）",
    response_model=OverviewReport,
)
def report_overview():
    """
    对应确认单 learning/overview 的统计。

    每个匿名用户一行：词条数、复习次数、今日完成数、近七日记得比例、
    平均作答时长、到期词条数。没有复习记录的用户也在结果里（LEFT JOIN）。
    """
    rows = storage.report_overview()
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total_users": len(rows),
        "rows": rows,
    }


@app.get(
    "/report/data",
    tags=["数据展示"],
    summary="报表数据（JSON，兼容课程样品路径）",
    response_model=OverviewReport,
)
def report_data():
    """与 /reports/overview 相同，保留样品文档中的路径。"""
    return report_overview()


def _ratio_cell(value: float | None) -> str:
    if value is None:
        return '<td class="muted">—</td>'
    pct = round(value * 100)
    width = max(0, min(100, pct))
    return (
        f'<td><div class="bar"><span style="width:{width}%"></span>'
        f'<em>{pct}%</em></div></td>'
    )


@app.get("/report", tags=["数据展示"], summary="学习统计报表页", response_class=HTMLResponse)
def report_page():
    """
    网页视图：用户学习概况 + 最近行为事件。

    用户表用 LEFT JOIN，未参与复习的人也显示；次数为 0，比例为空。
    """
    rows = storage.report_overview()
    events = storage.list_learning_events(limit=50)
    generated_at = datetime.now().isoformat(timespec="seconds")

    body_rows = []
    for row in rows:
        ratio = row.get("remembered_ratio_7d")
        avg = row.get("avg_duration_ms")
        avg_text = "—" if avg is None else f"{avg:g}"
        body_rows.append(
            "<tr>"
            f"<td>{escape(str(row['user_key']))}</td>"
            f"<td>{int(row['vocabulary_count'])}</td>"
            f"<td>{int(row['review_count'])}</td>"
            f"<td>{int(row['today_completed'])}</td>"
            f"{_ratio_cell(ratio)}"
            f"<td>{escape(avg_text)}</td>"
            f"<td>{int(row['due_count'])}</td>"
            "</tr>"
        )
    if not body_rows:
        body_rows.append(
            '<tr><td colspan="7" class="muted">暂无用户。先 POST /vocabulary_items 或 POST /events。</td></tr>'
        )

    event_rows = []
    for event in events:
        event_rows.append(
            "<tr>"
            f"<td>{escape(str(event['created_at']))}</td>"
            f"<td>{escape(str(event['user_key']))}</td>"
            f"<td>{escape(str(event['event_type']))}</td>"
            f"<td>{escape(str(event['target_type']))}</td>"
            f"<td>{escape(str(event['target_id']))}</td>"
            f"<td><code>{escape(str(event['payload']))}</code></td>"
            "</tr>"
        )
    if not event_rows:
        event_rows.append(
            '<tr><td colspan="6" class="muted">暂无行为事件。调用 POST /events 上报。</td></tr>'
        )

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CueLearn 学习统计</title>
  <style>
    :root {{
      --bg: #f6f3ee;
      --ink: #1f2a24;
      --muted: #5f6d66;
      --line: #d7ddd8;
      --accent: #0f766e;
      --card: #fffdf8;
    }}
    body {{
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 40%),
        linear-gradient(180deg, #eef5f2 0%, var(--bg) 45%, #f8f4ec 100%);
      min-height: 100vh;
    }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 32px 20px 48px; }}
    h1 {{ margin: 0 0 8px; font-size: 1.8rem; }}
    .meta {{ color: var(--muted); margin-bottom: 24px; }}
    .card {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(31, 42, 36, 0.04);
    }}
    h2 {{ margin: 0 0 12px; font-size: 1.15rem; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.95rem; }}
    th, td {{ padding: 10px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: middle; }}
    th {{ color: var(--muted); font-weight: 600; }}
    .muted {{ color: var(--muted); }}
    code {{ font-size: 0.85rem; }}
    .bar {{
      position: relative;
      min-width: 88px;
      height: 22px;
      background: #e7eeea;
      border-radius: 999px;
      overflow: hidden;
    }}
    .bar span {{
      display: block;
      height: 100%;
      background: linear-gradient(90deg, #14b8a6, var(--accent));
    }}
    .bar em {{
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-style: normal;
      font-size: 0.78rem;
      color: var(--ink);
    }}
    a {{ color: var(--accent); }}
  </style>
</head>
<body>
  <main>
    <h1>CueLearn 学习统计</h1>
    <p class="meta">
      生成于 {escape(generated_at)} · 共 {len(rows)} 名匿名用户 ·
      <a href="/docs">API 文档</a> ·
      <a href="/report/data">JSON 数据</a>
    </p>
    <section class="card">
      <h2>用户学习概况（LEFT JOIN，未参与者也显示）</h2>
      <table>
        <thead>
          <tr>
            <th>匿名用户</th>
            <th>词条数</th>
            <th>复习次数</th>
            <th>今日完成</th>
            <th>近七日记得</th>
            <th>平均时长 ms</th>
            <th>到期数</th>
          </tr>
        </thead>
        <tbody>
          {"".join(body_rows)}
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>最近行为事件（learning_events）</h2>
      <p class="meta">只采集匿名 user_key、动作、对象与时间；不采集真实姓名等敏感信息。</p>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>谁</th>
            <th>做了什么</th>
            <th>对象类型</th>
            <th>对象</th>
            <th>附加</th>
          </tr>
        </thead>
        <tbody>
          {"".join(event_rows)}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
"""
    return HTMLResponse(content=html)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8011)
