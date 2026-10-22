"""
CueLearn 学习数据接口测试。

运行：uv run pytest -v
每个测试通过 lifespan 使用独立临时 SQLite，不读取或清空本机 learn.db。
"""

from collections.abc import Iterator
from contextlib import closing
from datetime import datetime, timedelta
from html import escape
from pathlib import Path
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import storage
from app.main import app
from app.storage import init_db, list_review_queue

@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """每例独立建库，并通过上下文管理器执行真实的应用启动与关闭。"""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "learn.db")
    with TestClient(app) as test_client:
        yield test_client


def _save_word(
    client: TestClient,
    user_key: str = "anon-a",
    word: str = "context",
    sentence: str = "Keep the word in context.",
    definition: str = "the situation in which something happens",
):
    """通过真实 HTTP 路由准备词条，不跳过模型与数据库。"""
    return client.post(
        "/vocabulary_items",
        json={
            "user_key": user_key,
            "word": word,
            "definition": definition,
            "contexts": [
                {
                    "sentence": sentence,
                    "media_fingerprint": "sha256-demo",
                    "subtitle_index": 3,
                    "start_seconds": 12.5,
                }
            ],
        },
    )


def test_health(client: TestClient):
    """健康检查返回服务状态。"""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_create_and_get_vocabulary_item(client: TestClient):
    """收藏的词条和字幕语境能从数据库重新读取。"""
    resp = _save_word(client)
    assert resp.status_code == 201
    created = resp.json()
    assert created["id"] == 1
    assert created["user_key"] == "anon-a"
    assert created["word"] == "context"
    assert created["created_at"]
    assert len(created["contexts"]) == 1
    assert created["contexts"][0]["sentence"] == "Keep the word in context."
    assert created["contexts"][0]["start_seconds"] == 12.5
    assert "email" not in created

    fetched = client.get(f"/vocabulary_items/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["contexts"][0]["media_fingerprint"] == "sha256-demo"


def test_duplicate_word_appends_context_only(client: TestClient):
    """同词的不同语境追加到原词条，保留最初释义。"""
    first = _save_word(client).json()
    resp = _save_word(client,sentence="Another sentence with context.", definition="另一条释义")
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == first["id"]
    assert body["definition"] == "the situation in which something happens"
    assert len(body["contexts"]) == 2


def test_get_missing_vocabulary_item_returns_404(client: TestClient):
    """不存在的词条返回404及明确说明。"""
    resp = client.get("/vocabulary_items/999")
    assert resp.status_code == 404
    assert "不存在" in resp.json()["detail"]


def test_vocabulary_missing_field_returns_422(client: TestClient):
    """缺少必填字段或语境时返回422。"""
    resp = client.post(
        "/vocabulary_items",
        json={"user_key": "anon-a", "definition": "释义", "contexts": []},
    )
    assert resp.status_code == 422


def test_vocabulary_rejects_email_and_file_path(client: TestClient):
    """匿名标识不接受邮箱，媒体指纹不接受路径。"""
    resp = client.post(
        "/vocabulary_items",
        json={
            "user_key": "li@stu.edu",
            "word": "context",
            "definition": "释义",
            "contexts": [
                {
                    "sentence": "Keep the word in context.",
                    "media_fingerprint": "sha256-demo",
                    "subtitle_index": 0,
                    "start_seconds": 1,
                }
            ],
        },
    )
    assert resp.status_code == 422

    resp = _save_word(client)
    assert resp.status_code == 201
    path_like = client.post(
        "/vocabulary_items",
        json={
            "user_key": "anon-a",
            "word": "path",
            "definition": "路径不该当指纹",
            "contexts": [
                {
                    "sentence": "Do not store D paths.",
                    "media_fingerprint": "D:/videos/lecture.mp4",
                    "subtitle_index": 0,
                    "start_seconds": 0,
                }
            ],
        },
    )
    assert path_like.status_code == 422


def test_submit_review_and_list_by_user(client: TestClient):
    """评分保存后可按用户读取，空用户返回空列表。"""
    item = _save_word(client).json()
    resp = client.post(
        "/review_events",
        json={
            "user_key": "anon-a",
            "vocabulary_item_id": item["id"],
            "rating": "remembered",
            "duration_ms": 1800,
        },
    )
    assert resp.status_code == 201
    saved = resp.json()
    assert saved["rating"] == "remembered"
    assert saved["duration_ms"] == 1800
    assert saved["reviewed_at"]

    listed = client.get("/review_events", params={"user_key": "anon-a"})
    assert listed.status_code == 200
    body = listed.json()
    assert body["count"] == 1
    assert body["items"][0]["vocabulary_item_id"] == item["id"]

    other = client.get("/review_events", params={"user_key": "anon-none"})
    assert other.status_code == 200
    assert other.json()["count"] == 0


def test_review_missing_word_returns_404(client: TestClient):
    """为不存在的词条评分返回404。"""
    resp = client.post(
        "/review_events",
        json={"user_key": "anon-a", "vocabulary_item_id": 999, "rating": "forgot"},
    )
    assert resp.status_code == 404
    assert "不存在" in resp.json()["detail"]


def test_review_other_users_word_returns_404(client: TestClient):
    """不能为其他用户的词条评分，也不创建幽灵用户。"""
    item = _save_word(client,user_key="anon-owner").json()
    resp = client.post(
        "/review_events",
        json={
            "user_key": "anon-other",
            "vocabulary_item_id": item["id"],
            "rating": "vague",
        },
    )
    assert resp.status_code == 404
    keys = [row["user_key"] for row in client.get("/reports/overview").json()["rows"]]
    assert keys == ["anon-owner"]


def test_review_invalid_rating_returns_422(client: TestClient):
    """不支持的评分返回422。"""
    item = _save_word(client).json()
    resp = client.post(
        "/review_events",
        json={
            "user_key": "anon-a",
            "vocabulary_item_id": item["id"],
            "rating": "easy",
        },
    )
    assert resp.status_code == 422


def test_review_missing_field_returns_422(client: TestClient):
    """评分缺少词条标识时返回422。"""
    resp = client.post("/review_events", json={"user_key": "anon-a", "rating": "forgot"})
    assert resp.status_code == 422


def test_review_negative_duration_returns_422(client: TestClient):
    """负作答时长返回422。"""
    item = _save_word(client).json()
    resp = client.post(
        "/review_events",
        json={
            "user_key": "anon-a",
            "vocabulary_item_id": item["id"],
            "rating": "vague",
            "duration_ms": -1,
        },
    )
    assert resp.status_code == 422


def test_learning_event_is_stored(client: TestClient):
    """合法行为事件返回服务端标识和时间。"""
    resp = client.post(
        "/events",
        json={
            "user_key": "anon-a",
            "event_type": "hint_requested",
            "target_type": "subtitle",
            "target_id": "sha256-demo:3",
            "payload": '{"level":"syntax"}',
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["event_type"] == "hint_requested"
    assert body["payload"] == '{"level":"syntax"}'
    assert body["created_at"]


def test_learning_event_invalid_type_returns_422(client: TestClient):
    """不支持的事件类型返回422。"""
    resp = client.post(
        "/events",
        json={
            "user_key": "anon-a",
            "event_type": "page_view",
            "target_type": "media",
            "target_id": "sha256-demo",
        },
    )
    assert resp.status_code == 422


def test_learning_event_missing_field_returns_422(client: TestClient):
    """事件缺少对象字段时返回422。"""
    resp = client.post(
        "/events",
        json={"user_key": "anon-a", "event_type": "word_lookup"},
    )
    assert resp.status_code == 422


def test_learning_event_rejects_bad_or_sensitive_payload(client: TestClient):
    """拒绝无法解析的payload和敏感字段。"""
    bad_json = client.post(
        "/events",
        json={
            "user_key": "anon-a",
            "event_type": "word_lookup",
            "target_type": "vocabulary_item",
            "target_id": "1",
            "payload": "not-json",
        },
    )
    assert bad_json.status_code == 422

    sensitive = client.post(
        "/events",
        json={
            "user_key": "anon-a",
            "event_type": "word_lookup",
            "target_type": "vocabulary_item",
            "target_id": "1",
            "payload": '{"email":"li@stu.edu"}',
        },
    )
    assert sensitive.status_code == 422


def test_report_empty(client: TestClient):
    """空数据库的报表返回零用户和空行。"""
    resp = client.get("/reports/overview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_users"] == 0
    assert body["rows"] == []
    assert body["generated_at"]


def test_report_aggregates_and_keeps_users_without_reviews(client: TestClient):
    """
    LEFT JOIN：只上报事件的人、只收藏未复习的人，都要出现。
    没有任何复习时，记得比例和平均时长是 null，次数是 0。
    """
    kept = _save_word(client,user_key="anon-kept", word="metaphor").json()
    client.post(
        "/review_events",
        json={
            "user_key": "anon-kept",
            "vocabulary_item_id": kept["id"],
            "rating": "remembered",
            "duration_ms": 800,
        },
    )

    client.post(
        "/events",
        json={
            "user_key": "anon-listener",
            "event_type": "sentence_replayed",
            "target_type": "subtitle",
            "target_id": "sha256-demo:1",
        },
    )

    mixed = _save_word(client,user_key="anon-mixed", word="idiom").json()
    client.post(
        "/review_events",
        json={
            "user_key": "anon-mixed",
            "vocabulary_item_id": mixed["id"],
            "rating": "remembered",
            "duration_ms": 1000,
        },
    )
    client.post(
        "/review_events",
        json={
            "user_key": "anon-mixed",
            "vocabulary_item_id": mixed["id"],
            "rating": "forgot",
            "duration_ms": 3000,
        },
    )

    _save_word(client,user_key="anon-pending", word="cue")

    rows = {
        row["user_key"]: row for row in client.get("/reports/overview").json()["rows"]
    }
    assert list(rows) == ["anon-kept", "anon-listener", "anon-mixed", "anon-pending"]

    assert rows["anon-kept"]["vocabulary_count"] == 1
    assert rows["anon-kept"]["review_count"] == 1
    assert rows["anon-kept"]["today_completed"] == 1
    assert rows["anon-kept"]["remembered_ratio_7d"] == 1.0
    assert rows["anon-kept"]["avg_duration_ms"] == 800.0
    assert rows["anon-kept"]["due_count"] == 0

    assert rows["anon-listener"]["vocabulary_count"] == 0
    assert rows["anon-listener"]["review_count"] == 0
    assert rows["anon-listener"]["today_completed"] == 0
    assert rows["anon-listener"]["remembered_ratio_7d"] is None
    assert rows["anon-listener"]["avg_duration_ms"] is None
    assert rows["anon-listener"]["due_count"] == 0

    assert rows["anon-mixed"]["vocabulary_count"] == 1
    assert rows["anon-mixed"]["review_count"] == 2
    assert rows["anon-mixed"]["today_completed"] == 2
    assert rows["anon-mixed"]["remembered_ratio_7d"] == 0.5
    assert rows["anon-mixed"]["avg_duration_ms"] == 2000.0
    assert rows["anon-mixed"]["due_count"] == 1

    assert rows["anon-pending"]["vocabulary_count"] == 1
    assert rows["anon-pending"]["review_count"] == 0
    assert rows["anon-pending"]["today_completed"] == 0
    assert rows["anon-pending"]["remembered_ratio_7d"] is None
    assert rows["anon-pending"]["avg_duration_ms"] is None
    assert rows["anon-pending"]["due_count"] == 1


def test_report_page_renders(client: TestClient):
    """报表页可展示数据库中的匿名用户。"""
    _save_word(client,user_key="anon-view", word="render")
    resp = client.get("/report")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "anon-view" in resp.text
    assert "LEFT JOIN" in resp.text


def test_review_queue_follows_latest_rating(client: TestClient):
    """最新评分决定简化复习队列的到期状态。"""
    item = _save_word(client).json()
    assert len(list_review_queue("anon-a")) == 1

    client.post(
        "/review_events",
        json={
            "user_key": "anon-a",
            "vocabulary_item_id": item["id"],
            "rating": "remembered",
            "duration_ms": 500,
        },
    )
    assert list_review_queue("anon-a") == []


def test_data_persists_across_reconnect(client: TestClient):
    """重复初始化不清除已保存的词条。"""
    created = _save_word(client,word="persist").json()
    init_db()
    fetched = client.get(f"/vocabulary_items/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["word"] == "persist"


def test_admin_reset_clears_data(client: TestClient):
    """明确调用重置接口后业务数据被清空。"""
    _save_word(client)
    assert client.get("/reports/overview").json()["total_users"] == 1
    assert client.delete("/admin/reset").status_code == 200
    assert client.get("/reports/overview").json()["total_users"] == 0


def _review(client: TestClient, item: dict, rating: str, duration_ms: int | None = None):
    """通过接口写入评分，并要求成功后才把数据用于统计断言。"""
    response = client.post(
        "/review_events",
        json={
            "user_key": item["user_key"],
            "vocabulary_item_id": item["id"],
            "rating": rating,
            "duration_ms": duration_ms,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _event_body() -> dict:
    """生成仅包含合成匿名数据的行为请求。"""
    return {
        "user_key": "anon-event",
        "event_type": "sentence_replayed",
        "target_type": "subtitle",
        "target_id": "media-demo:3",
        "payload": "{}",
    }


def test_duplicate_identical_context_is_saved_once(client: TestClient):
    """相同收藏重试不会增加语境数量，真正的新语境仍能追加。"""
    first = _save_word(client).json()
    repeated = _save_word(client)
    assert repeated.status_code == 201
    assert repeated.json() == first
    new_context = _save_word(client, sentence="A different context.")
    assert new_context.status_code == 201
    assert len(new_context.json()["contexts"]) == 2


def test_users_have_independent_vocabulary_and_review_lists(client: TestClient):
    """同词按匿名用户分别保存，评分列表不会混入其他用户的作答。"""
    first = _save_word(client, user_key="anon-first").json()
    second = _save_word(client, user_key="anon-second").json()
    assert first["id"] != second["id"]
    _review(client, first, "forgot", 1000)
    _review(client, second, "remembered", 2000)
    for item in [first, second]:
        response = client.get("/review_events", params={"user_key": item["user_key"]})
        assert response.status_code == 200
        assert response.json()["count"] == 1
        assert response.json()["items"][0]["vocabulary_item_id"] == item["id"]


@pytest.mark.parametrize("rating", ["forgot", "vague", "remembered"])
def test_each_rating_is_persisted(client: TestClient, rating: str):
    """三个合法评分都按原值保存到真实数据库。"""
    item = _save_word(client).json()
    event = _review(client, item, rating, 500)
    assert event["rating"] == rating
    assert storage.list_review_events(item["user_key"]) == [event]


@pytest.mark.parametrize("duration", [None, 0, 2**63 - 1], ids=["未采集", "零毫秒", "SQLite整数上界"])
def test_valid_duration_boundaries_are_preserved(client: TestClient, duration: int | None):
    """缺失、真实零时长和可存储的最大整数保持原值。"""
    item = _save_word(client).json()
    saved = _review(client, item, "vague", duration)
    assert saved["duration_ms"] == duration
    assert storage.list_review_events(item["user_key"])[0]["duration_ms"] == duration


@pytest.mark.parametrize("duration", [True, 1.0, "1000", -1, 2**63], ids=["布尔", "小数", "字符串", "负数", "溢出"])
def test_invalid_duration_returns_422_without_writing(client: TestClient, duration):
    """时长非法时返回422，不能强制转换或触发数据库500。"""
    item = _save_word(client).json()
    response = client.post(
        "/review_events",
        json={"user_key": item["user_key"], "vocabulary_item_id": item["id"], "rating": "forgot", "duration_ms": duration},
    )
    assert response.status_code == 422
    assert "duration_ms" in response.json()["detail"][0]["loc"]
    assert storage.list_review_events(item["user_key"]) == []


@pytest.mark.parametrize("item_id", [0, -1, True, 1.0, "1", 2**63])
def test_invalid_review_item_id_returns_422(client: TestClient, item_id):
    """词条标识必须是正整数，不能超过SQLite可存储范围。"""
    _save_word(client)
    response = client.post(
        "/review_events",
        json={"user_key": "anon-a", "vocabulary_item_id": item_id, "rating": "forgot"},
    )
    assert response.status_code == 422
    assert "vocabulary_item_id" in response.json()["detail"][0]["loc"]
    assert storage.list_review_events("anon-a") == []


@pytest.mark.parametrize("item_id", [0, -1, 2**63, "not-an-id", "1.5"])
def test_invalid_vocabulary_path_returns_422(client: TestClient, item_id):
    """查询路径格式错误或超界时返回422，合法但不存在才返回404。"""
    response = client.get(f"/vocabulary_items/{item_id}")
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["path", "vocabulary_item_id"]


@pytest.mark.parametrize(
    ("field", "value"),
    [("subtitle_index", -1), ("subtitle_index", True), ("subtitle_index", 1.0), ("subtitle_index", "3"), ("subtitle_index", 2**63),
     ("start_seconds", -1), ("start_seconds", True), ("start_seconds", "12.5")],
)
def test_invalid_context_numbers_return_422(client: TestClient, field: str, value):
    """字幕序号和秒数拒绝错误类型、负数与不可存储的整数。"""
    payload = {
        "user_key": "anon-invalid", "word": "invalid", "definition": "合成释义",
        "contexts": [{"sentence": "Synthetic context.", "media_fingerprint": "demo", "subtitle_index": 0, "start_seconds": 1}],
    }
    payload["contexts"][0][field] = value
    response = client.post("/vocabulary_items", json=payload)
    assert response.status_code == 422
    assert field in response.json()["detail"][0]["loc"]
    assert client.get("/reports/overview").json()["total_users"] == 0


def test_nonfinite_context_time_returns_422(client: TestClient):
    """合法JSON中的过大数值不能被保存为无穷秒数再返回null。"""
    response = client.post(
        "/vocabulary_items", headers={"content-type": "application/json"},
        content='{"user_key":"anon-invalid","word":"invalid","definition":"demo","contexts":[{"sentence":"Demo.","media_fingerprint":"demo","subtitle_index":0,"start_seconds":1e309}]}',
    )
    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "finite_number"
    assert set(response.json()["detail"][0]) == {"type", "loc", "msg"}
    assert client.get("/reports/overview").json()["total_users"] == 0


@pytest.mark.parametrize("key", ["password", "ACCESS_TOKEN", "refresh_token", "api_key"])
def test_nested_sensitive_payload_is_rejected(client: TestClient, key: str):
    """嵌套对象和数组中的敏感键同样被拒绝，不生成事件或用户。"""
    payload = _event_body()
    payload["payload"] = json.dumps({"nested": [{key: "synthetic-test-value"}]})
    response = client.post("/events", json=payload)
    assert response.status_code == 422
    assert storage.list_learning_events() == []
    assert client.get("/reports/overview").json()["total_users"] == 0


@pytest.mark.parametrize("value", ["[]", '"text"', "{invalid", '{"nested":[{"email":"demo@example.invalid"}]}'])
def test_invalid_payload_is_rejected_without_writing(client: TestClient, value: str):
    """payload需要合法JSON对象，并递归拒绝敏感字段。"""
    payload = _event_body()
    payload["payload"] = value
    assert client.post("/events", json=payload).status_code == 422
    assert storage.list_learning_events() == []


@pytest.mark.parametrize("endpoint", ["/vocabulary_items", "/review_events", "/events"])
def test_create_rejects_server_generated_and_unknown_fields(client: TestClient, endpoint: str):
    """创建请求不能夹带服务端主键和未声明的个人信息字段。"""
    item = _save_word(client).json()
    payloads = {
        "/vocabulary_items": {"user_key": "anon-a", "word": "new", "definition": "释义", "contexts": [{"sentence": "Demo.", "media_fingerprint": "demo", "subtitle_index": 0, "start_seconds": 0}]},
        "/review_events": {"user_key": "anon-a", "vocabulary_item_id": item["id"], "rating": "forgot"},
        "/events": _event_body(),
    }
    payload = payloads[endpoint] | {"id": 123, "email": "demo@example.invalid"}
    response = client.post(endpoint, json=payload)
    assert response.status_code == 422
    assert {error["loc"][-1] for error in response.json()["detail"]} == {"id", "email"}
    assert storage.list_learning_events() == []
    assert storage.list_review_events("anon-a") == []


def test_context_rejects_extra_fields(client: TestClient):
    """嵌套语境也不静默接收客户端提供的数据库主键。"""
    response = client.post("/vocabulary_items", json={
        "user_key": "anon-a", "word": "demo", "definition": "释义",
        "contexts": [{"id": 123, "sentence": "Demo.", "media_fingerprint": "demo", "subtitle_index": 0, "start_seconds": 0}],
    })
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "contexts", 0, "id"]


def test_event_and_sql_values_are_persisted_literally(client: TestClient):
    """合法文本含SQL标点时原样保存，不改变表结构或其他记录。"""
    word = "word'); DROP TABLE users; --"
    item = _save_word(client, word=word).json()
    assert client.get(f"/vocabulary_items/{item['id']}").json()["word"] == word
    payload = _event_body()
    payload["payload"] = json.dumps({"hint": "'; DROP TABLE users; --"})
    response = client.post("/events", json=payload)
    assert response.status_code == 201
    assert storage.get_learning_event(response.json()["id"]) == response.json()
    assert storage.get_learning_event(response.json()["id"] + 1) is None
    assert client.get("/reports/overview").json()["total_users"] == 2


def test_report_joins_do_not_multiply_counts(client: TestClient):
    """多个词条与多条复习分别聚合，LEFT JOIN不能放大次数。"""
    first = _save_word(client, word="first").json()
    _save_word(client, word="second")
    _save_word(client, word="third")
    _review(client, first, "remembered", 1000)
    _review(client, first, "forgot", 3000)
    row = client.get("/reports/overview").json()["rows"][0]
    assert row == {"user_key": "anon-a", "vocabulary_count": 3, "review_count": 2,
                   "today_completed": 2, "remembered_ratio_7d": 0.5, "avg_duration_ms": 2000.0, "due_count": 3}


def test_unrecorded_duration_is_not_counted_as_zero(client: TestClient):
    """平均时长只用已采集值，零毫秒仍是有效值。"""
    item = _save_word(client).json()
    _review(client, item, "forgot", None)
    assert client.get("/reports/overview").json()["rows"][0]["avg_duration_ms"] is None
    _review(client, item, "vague", 0)
    _review(client, item, "remembered", 1000)
    row = client.get("/reports/overview").json()["rows"][0]
    assert row["review_count"] == 3
    assert row["avg_duration_ms"] == 500.0
    assert row["remembered_ratio_7d"] == pytest.approx(0.3333)


def test_report_separates_today_and_recent_history(client: TestClient):
    """今日次数、七日记得比例和全部已记录时长各按自己的口径计算。"""
    item = _save_word(client).json()
    old = _review(client, item, "remembered", 1000)
    recent = _review(client, item, "forgot", 3000)
    _review(client, item, "remembered", None)
    now = datetime.now().replace(microsecond=0)
    with closing(sqlite3.connect(storage.DB_PATH)) as connection, connection:
        connection.execute("UPDATE review_events SET reviewed_at = ? WHERE id = ?", ((now - timedelta(days=8)).isoformat(), old["id"]))
        connection.execute("UPDATE review_events SET reviewed_at = ? WHERE id = ?", ((now - timedelta(days=2)).isoformat(), recent["id"]))
    row = client.get("/reports/overview").json()["rows"][0]
    assert row["review_count"] == 3
    assert row["today_completed"] == 1
    assert row["remembered_ratio_7d"] == 0.5
    assert row["avg_duration_ms"] == 2000.0
    assert row["due_count"] == 0


@pytest.mark.parametrize(("rating", "days_ago", "due"), [("vague", 0, False), ("vague", 2, True), ("remembered", 2, False), ("remembered", 4, True)])
def test_due_count_matches_the_review_queue(client: TestClient, rating: str, days_ago: int, due: bool):
    """简化间隔的待复习队列与报表到期数保持一致。"""
    item = _save_word(client).json()
    event = _review(client, item, rating)
    when = datetime.now().replace(microsecond=0) - timedelta(days=days_ago)
    with closing(sqlite3.connect(storage.DB_PATH)) as connection, connection:
        connection.execute("UPDATE review_events SET reviewed_at = ? WHERE id = ?", (when.isoformat(), event["id"]))
    assert len(list_review_queue("anon-a")) == int(due)
    assert client.get("/reports/overview").json()["rows"][0]["due_count"] == int(due)


def test_html_and_json_reports_show_the_same_users(client: TestClient):
    """两个JSON入口和HTML都保留零复习用户，HTML转义事件文本。"""
    item = _save_word(client).json()
    _review(client, item, "remembered", 500)
    payload = _event_body()
    text = "<script>alert('synthetic')</script>"
    payload["payload"] = json.dumps({"hint": text})
    assert client.post("/events", json=payload).status_code == 201
    overview = client.get("/reports/overview").json()
    data = client.get("/report/data").json()
    assert data["rows"] == overview["rows"]
    assert data["total_users"] == overview["total_users"] == 2
    page = client.get("/report")
    assert page.status_code == 200
    for row in overview["rows"]:
        assert f"<td>{row['user_key']}</td>" in page.text
    assert "100%" in page.text
    assert escape(text) in page.text
    assert text not in page.text


def test_persistence_across_application_lifespans(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """关闭整个客户端生命周期再启动时，词条、复习和事件仍保留。"""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "restarted.db")
    with TestClient(app) as first:
        item = _save_word(first).json()
        review = _review(first, item, "remembered", 123)
        event = first.post("/events", json=_event_body()).json()
    with TestClient(app) as second:
        assert second.get(f"/vocabulary_items/{item['id']}").json() == item
        assert second.get("/review_events", params={"user_key": "anon-a"}).json()["items"] == [review]
        assert storage.get_learning_event(event["id"]) == event


def test_connections_are_closed_after_commit_and_rollback(client: TestClient):
    """真实事务提交或回滚后都关闭连接，不依赖垃圾回收释放文件。"""
    with storage._connect() as connection:
        connection.execute("INSERT INTO users (user_key, created_at) VALUES (?, ?)", ("committed", "2026-10-22T12:00:00"))
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")
    with pytest.raises(ValueError, match="synthetic rollback"):
        with storage._connect() as failed:
            failed.execute("INSERT INTO users (user_key, created_at) VALUES (?, ?)", ("rolled-back", "2026-10-22T12:00:00"))
            raise ValueError("synthetic rollback")
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        failed.execute("SELECT 1")
    assert [row["user_key"] for row in client.get("/reports/overview").json()["rows"]] == ["committed"]


@pytest.mark.parametrize(
    ("route", "create_model", "response_model"),
    [("/vocabulary_items", "VocabularyItemCreate", "VocabularyItemResponse"),
     ("/review_events", "ReviewEventCreate", "ReviewEventResponse"),
     ("/events", "LearningEventCreate", "LearningEventResponse")],
)
def test_create_and_response_models_are_separate(client: TestClient, route: str, create_model: str, response_model: str):
    """OpenAPI中的创建和返回模型分开，成功响应显式声明返回结构。"""
    operation = client.get("/openapi.json").json()["paths"][route]["post"]
    request = operation["requestBody"]["content"]["application/json"]["schema"]
    response = operation["responses"]["201"]["content"]["application/json"]["schema"]
    assert request["$ref"] == f"#/components/schemas/{create_model}"
    assert response["$ref"] == f"#/components/schemas/{response_model}"


@pytest.mark.parametrize("params", [{}, {"user_key": ""}, {"user_key": "demo@example.invalid"}])
def test_invalid_review_query_returns_422(client: TestClient, params: dict):
    """查询也要求合法匿名标识，不能用缺失或个人邮箱查询。"""
    response = client.get("/review_events", params=params)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["query", "user_key"]
