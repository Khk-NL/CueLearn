"""通过真实临时 SQLite 验证课程接口、重复事件和零参与者统计。"""

import ast
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import ReviewEventCreate
from app.storage import LearningStorage


@pytest.fixture
def client(tmp_path: Path):
    """每个测试启动独立应用和独立文件数据库，退出时完成生命周期关闭。"""
    with TestClient(create_app(tmp_path / "course.db")) as active:
        yield active


def register(client: TestClient) -> dict:
    """通过实际注册接口取得匿名参与者，不预置或伪造存储结果。"""
    response = client.post("/learners", json={})
    assert response.status_code == 201
    return response.json()


def event_body(learner_id: str, **changes) -> dict:
    """构建合成复习事件，允许测试仅覆盖需要改变的字段。"""
    return {
        "learner_id": learner_id,
        "object_id": "word:lesson_01",
        "action": "review_submitted",
        "occurred_at": "2026-10-19T11:00:00+08:00",
        "rating": "remembered",
        "duration_ms": 12000,
        "client_event_id": str(uuid4()),
        **changes,
    }


def test_匿名参与者注册后能查询且标识由服务端生成(client):
    """创建和列表返回一致的 UUID 与带 UTC 时区的创建时间。"""
    learner = register(client)
    assert set(learner) == {"id", "created_at"}
    assert UUID(learner["id"]).version == 4
    assert datetime.fromisoformat(learner["created_at"]).utcoffset() == timedelta(0)
    assert client.get("/learners").json() == [learner]


@pytest.mark.parametrize("field", ["name", "email", "id"])
def test_注册拒绝个人信息和调用方指定的服务端字段(client, field):
    """不接受模型之外的个人字段，也不允许调用方覆盖服务端标识。"""
    response = client.post("/learners", json={field: "should-not-be-stored"})
    assert response.status_code == 422
    assert client.get("/learners").json() == []


def test_复习事件提交查询与时间归一化(client):
    """接口保存输入并返回独立事件标识，将北京时间转换为 UTC。"""
    learner = register(client)
    body = event_body(learner["id"])
    response = client.post("/review-events", json=body)
    assert response.status_code == 201
    event = response.json()
    assert UUID(event["id"]).version == 4
    assert event["id"] != body["client_event_id"]
    assert event["occurred_at"] == "2026-10-19T03:00:00Z"
    assert datetime.fromisoformat(event["received_at"]).utcoffset() == timedelta(0)
    for field in ["learner_id", "object_id", "rating", "duration_ms", "client_event_id", "action"]:
        assert event[field] == body[field]
    assert client.get(f"/review-events/{event['id']}").json() == event
    assert client.get("/review-events").json() == [event]


@pytest.mark.parametrize("field", ["learner_id", "object_id", "occurred_at", "rating", "duration_ms", "client_event_id"])
def test_缺少事件必填字段返回422且不写入(client, field):
    """请求校验错误不会转换为成功或写入不完整事件。"""
    body = event_body(register(client)["id"])
    del body[field]
    response = client.post("/review-events", json=body)
    assert response.status_code == 422
    assert any(error["loc"][-1] == field for error in response.json()["detail"])
    assert client.get("/review-events").json() == []


@pytest.mark.parametrize(("field", "value"), [
    ("duration_ms", -1), ("duration_ms", "12000"), ("duration_ms", 1.5),
    ("duration_ms", True), ("duration_ms", 2_147_483_648), ("duration_ms", None),
    ("rating", "easy"), ("occurred_at", "2026-10-19T11:00:00"),
    ("occurred_at", 0), ("occurred_at", "1234"), ("occurred_at", "not-a-date"),
    ("object_id", ""), ("object_id", "C:\\video\\private.mp4"),
    ("object_id", "word';DROP TABLE learners;--"), ("action", "review_cancelled"),
    ("learner_id", "bad-id"), ("client_event_id", "bad-id"),
])
def test_非法事件字段返回422且不写入(client, field, value):
    """拒绝非法枚举、负时长、隐式类型转换、无时区日期和路径等输入。"""
    body = event_body(register(client)["id"])
    body[field] = value
    assert client.post("/review-events", json=body).status_code == 422
    assert client.get("/review-events").json() == []


def test_事件拒绝额外的凭据字段(client):
    """敏感额外字段不会作为事件元数据被静默保存。"""
    body = event_body(register(client)["id"], password="synthetic-only")
    assert client.post("/review-events", json=body).status_code == 422
    assert client.get("/review-events").json() == []


def test_零毫秒与默认提交动作可以保存(client):
    """合法的零时长与缺失样本不同，省略动作时使用唯一支持的提交动作。"""
    body = event_body(register(client)["id"], duration_ms=0)
    del body["action"]
    response = client.post("/review-events", json=body)
    assert response.status_code == 201
    assert response.json()["action"] == "review_submitted"
    assert client.get("/stats/learners").json()[0]["average_duration_ms"] == 0


def test_不存在的关联参与者和事件返回404(client):
    """合法 UUID 但资源不存在时采用领域404，不生成孤立事件。"""
    missing = str(uuid4())
    assert client.post("/review-events", json=event_body(missing)).status_code == 404
    assert client.get("/review-events", params={"learner_id": missing}).status_code == 404
    assert client.get(f"/review-events/{missing}").status_code == 404
    assert client.get("/review-events").json() == []


@pytest.mark.parametrize("url", [
    "/review-events/not-a-uuid", "/review-events?learner_id=bad",
    "/review-events?limit=0", "/review-events?limit=501",
    "/review-events?offset=-1", "/review-events?limit=abc",
    "/review-events?offset=9223372036854775808",
])
def test_非法路径与查询参数返回422(client, url):
    """UUID 格式和分页边界由接口校验，不进入错误的数据库查询。"""
    assert client.get(url).status_code == 422


def test_相同事件与等价时区重试返回原记录且只统计一次(client):
    """去重比较使用标准化 UTC，重复提交不生成新事件或改变接收时间。"""
    body = event_body(register(client)["id"])
    first = client.post("/review-events", json=body)
    body["occurred_at"] = "2026-10-19T03:00:00Z"
    retry = client.post("/review-events", json=body)
    assert first.status_code == 201
    assert retry.status_code == 200
    assert first.json() == retry.json()
    assert len(client.get("/review-events").json()) == 1
    assert client.get("/stats/learners").json()[0]["review_count"] == 1


def test_同键不同内容返回409且不覆盖旧事件(client):
    """冲突不会改写原始事实，也不会增加复习次数或累计时长。"""
    body = event_body(register(client)["id"])
    original = client.post("/review-events", json=body).json()
    response = client.post("/review-events", json={**body, "rating": "forgot"})
    assert response.status_code == 409
    assert "client_event_id" in response.json()["detail"]
    assert client.get(f"/review-events/{original['id']}").json() == original
    assert client.get("/stats/learners").json()[0]["total_duration_ms"] == 12000


def test_不同参与者可以使用相同客户端事件标识(client):
    """去重范围是参与者与客户端事件标识组合，不跨参与者误删事件。"""
    key = str(uuid4())
    for _ in range(2):
        body = event_body(register(client)["id"], client_event_id=key)
        assert client.post("/review-events", json=body).status_code == 201
    assert len(client.get("/review-events").json()) == 2


def test_事件列表按参与者筛选并正确分页(client):
    """分页基于发生时间排序，其他参与者事件不会混入筛选结果。"""
    first = register(client)["id"]
    second = register(client)["id"]
    events = []
    for number in range(3):
        body = event_body(first, occurred_at=f"2026-10-19T03:00:0{number}Z")
        events.append(client.post("/review-events", json=body).json())
    assert client.post("/review-events", json=event_body(second)).status_code == 201
    response = client.get("/review-events", params={"learner_id": first, "limit": 1, "offset": 1})
    assert response.status_code == 200
    assert response.json() == [events[1]]


def test_报表包含零参与者并准确计算三档评分与时长(client):
    """左连接不丢失未参与者，记得比例按事件而不是去重词条计算。"""
    active = register(client)["id"]
    inactive = register(client)["id"]
    for rating, duration in [("forgot", 1000), ("unsure", 2000), ("remembered", 3000)]:
        assert client.post("/review-events", json=event_body(active, rating=rating, duration_ms=duration)).status_code == 201
    response = client.get("/stats/learners")
    assert response.status_code == 200
    rows = {row["learner_id"]: row for row in response.json()}
    assert rows[active] == {
        "learner_id": active, "review_count": 3, "total_duration_ms": 6000,
        "average_duration_ms": 2000, "remembered_rate": pytest.approx(1 / 3),
    }
    assert rows[inactive] == {
        "learner_id": inactive, "review_count": 0, "total_duration_ms": 0,
        "average_duration_ms": None, "remembered_rate": None,
    }


def test_空数据库各列表和统计均返回空数组(client):
    """没有注册样本时不补造参与者或演示数据。"""
    for route in ["/learners", "/review-events", "/stats/learners"]:
        response = client.get(route)
        assert response.status_code == 200
        assert response.json() == []


def test_应用重启后能读取真实文件中的事件且连接已关闭(tmp_path):
    """跨应用生命周期持久化不依赖进程列表，关闭后数据库文件可移动。"""
    database = tmp_path / "persistent.db"
    with TestClient(create_app(database)) as first:
        learner = register(first)["id"]
        event = first.post("/review-events", json=event_body(learner)).json()
    moved = database.rename(tmp_path / "reopened.db")
    with TestClient(create_app(moved)) as second:
        assert second.get(f"/review-events/{event['id']}").json() == event
        assert second.get("/stats/learners").json()[0]["review_count"] == 1
    with sqlite3.connect(moved) as connection:
        assert connection.execute("SELECT COUNT(*) FROM review_events").fetchone()[0] == 1


def test_并发重试仍只保存一条真实事件(client):
    """两个独立 SQLite 连接提交相同事件，唯一约束保证只有一条事实记录。"""
    payload = ReviewEventCreate.model_validate(event_body(register(client)["id"]))
    database = client.app.state.storage.database_path
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda _: LearningStorage(database).save_event(payload), range(2)))
    assert {result[0]["id"] for result in results} == {results[0][0]["id"]}
    assert sorted(result[1] for result in results) == [False, True]
    assert client.get("/stats/learners").json()[0]["review_count"] == 1


def test_真实存储中的额外内部字段被响应模型过滤(client):
    """数据库额外字段不会经创建或列表接口泄露，不替换真实存储方法。"""
    with sqlite3.connect(client.app.state.storage.database_path) as connection:
        connection.execute("ALTER TABLE learners ADD COLUMN internal_note TEXT DEFAULT 'synthetic-internal'")
    learner = register(client)
    assert set(learner) == {"id", "created_at"}
    assert client.get("/learners").json() == [learner]
    with sqlite3.connect(client.app.state.storage.database_path) as connection:
        assert connection.execute("SELECT internal_note FROM learners").fetchone()[0] == "synthetic-internal"


def test_所有业务接口显式声明模型且文档响应结构一致(client):
    """核对装饰器显式声明、注册结果、成功响应 schema 和可访问的文档。"""
    assert client.get("/docs").status_code == 200
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    routes = [route for route in client.app.routes if isinstance(route, APIRoute)]
    assert len(routes) == 6
    assert all(route.response_model is not None for route in routes)
    for route in routes:
        for method in route.methods:
            operation = schema["paths"][route.path][method.lower()]
            success = operation["responses"][str(route.status_code or 200)]
            model_schema = success["content"]["application/json"]["schema"]
            assert "$ref" in model_schema or "$ref" in model_schema.get("items", {})
    source = Path(__file__).resolve().parents[1] / "app" / "main.py"
    decorators = [
        decorator
        for node in ast.walk(ast.parse(source.read_text(encoding="utf-8")))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for decorator in node.decorator_list
        if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute)
        and decorator.func.attr in {"get", "post", "put", "patch", "delete"}
    ]
    assert len(decorators) == 6
    assert all(any(item.arg == "response_model" for item in node.keywords) for node in decorators)
    assert schema["components"]["schemas"]["LearnerCreate"].get("properties", {}) == {}
    assert "id" not in schema["components"]["schemas"]["ReviewEventCreate"]["properties"]
    assert "received_at" not in schema["components"]["schemas"]["ReviewEventCreate"]["properties"]


def test_仅导入应用不创建配置中的数据库(tmp_path):
    """独立进程导入模块时没有数据库或目录副作用。"""
    database = tmp_path / "not-created" / "learn.db"
    environment = {**os.environ, "CUELEARN_API_DB": str(database)}
    completed = subprocess.run(
        [sys.executable, "-c", "import app.main"], env=environment, capture_output=True, text=True,
        cwd=Path(__file__).resolve().parents[1], check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert not database.parent.exists()


def test_启动使用显式环境配置且空配置直接报错(tmp_path, monkeypatch):
    """环境变量在启动阶段生效，错误配置不静默写入另一个默认数据库。"""
    database = tmp_path / "configured.db"
    monkeypatch.setenv("CUELEARN_API_DB", str(database))
    with TestClient(create_app()) as configured:
        register(configured)
    assert database.exists()
    monkeypatch.setenv("CUELEARN_API_DB", " ")
    with pytest.raises(ValueError, match="CUELEARN_API_DB 不能为空"):
        with TestClient(create_app()):
            pass
