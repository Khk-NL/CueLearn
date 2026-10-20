"""
CueLearn 学习数据接口测试。

运行：uv run pytest -v
每个测试前清空 SQLite，避免互相污染。
"""

from fastapi.testclient import TestClient

from app.main import app
from app.storage import init_db, list_review_queue, reset_db

client = TestClient(app)


def setup_function():
    init_db()
    reset_db()


def _save_word(
    user_key: str = "anon-a",
    word: str = "context",
    sentence: str = "Keep the word in context.",
    definition: str = "the situation in which something happens",
):
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


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_create_and_get_vocabulary_item():
    resp = _save_word()
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


def test_duplicate_word_appends_context_only():
    first = _save_word().json()
    resp = _save_word(sentence="Another sentence with context.", definition="另一条释义")
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == first["id"]
    assert body["definition"] == "the situation in which something happens"
    assert len(body["contexts"]) == 2


def test_get_missing_vocabulary_item_returns_404():
    resp = client.get("/vocabulary_items/999")
    assert resp.status_code == 404
    assert "不存在" in resp.json()["detail"]


def test_vocabulary_missing_field_returns_422():
    resp = client.post(
        "/vocabulary_items",
        json={"user_key": "anon-a", "definition": "释义", "contexts": []},
    )
    assert resp.status_code == 422


def test_vocabulary_rejects_email_and_file_path():
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

    resp = _save_word()
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


def test_submit_review_and_list_by_user():
    item = _save_word().json()
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


def test_review_missing_word_returns_404():
    resp = client.post(
        "/review_events",
        json={"user_key": "anon-a", "vocabulary_item_id": 999, "rating": "forgot"},
    )
    assert resp.status_code == 404
    assert "不存在" in resp.json()["detail"]


def test_review_other_users_word_returns_404():
    item = _save_word(user_key="anon-owner").json()
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


def test_review_invalid_rating_returns_422():
    item = _save_word().json()
    resp = client.post(
        "/review_events",
        json={
            "user_key": "anon-a",
            "vocabulary_item_id": item["id"],
            "rating": "easy",
        },
    )
    assert resp.status_code == 422


def test_review_missing_field_returns_422():
    resp = client.post("/review_events", json={"user_key": "anon-a", "rating": "forgot"})
    assert resp.status_code == 422


def test_review_negative_duration_returns_422():
    item = _save_word().json()
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


def test_learning_event_is_stored():
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


def test_learning_event_invalid_type_returns_422():
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


def test_learning_event_missing_field_returns_422():
    resp = client.post(
        "/events",
        json={"user_key": "anon-a", "event_type": "word_lookup"},
    )
    assert resp.status_code == 422


def test_learning_event_rejects_bad_or_sensitive_payload():
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


def test_report_empty():
    resp = client.get("/reports/overview")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_users"] == 0
    assert body["rows"] == []
    assert body["generated_at"]


def test_report_aggregates_and_keeps_users_without_reviews():
    """
    LEFT JOIN：只上报事件的人、只收藏未复习的人，都要出现。
    近七日没有复习时，记得比例和平均时长是 null，次数是 0。
    """
    kept = _save_word(user_key="anon-kept", word="metaphor").json()
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

    mixed = _save_word(user_key="anon-mixed", word="idiom").json()
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

    _save_word(user_key="anon-pending", word="cue")

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


def test_report_page_renders():
    _save_word(user_key="anon-view", word="render")
    resp = client.get("/report")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "anon-view" in resp.text
    assert "LEFT JOIN" in resp.text


def test_review_queue_follows_latest_rating():
    item = _save_word().json()
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


def test_data_persists_across_reconnect():
    created = _save_word(word="persist").json()
    init_db()
    fetched = client.get(f"/vocabulary_items/{created['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["word"] == "persist"


def test_admin_reset_clears_data():
    _save_word()
    assert client.get("/reports/overview").json()["total_users"] == 1
    assert client.delete("/admin/reset").status_code == 200
    assert client.get("/reports/overview").json()["total_users"] == 0
