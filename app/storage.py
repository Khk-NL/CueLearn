"""
CueLearn 学习数据的 SQLite 存储层。

main.py 只调用这里的函数，不写 SQL。
所有参数都用 ? 占位符传入，不把外部字符串拼进 SQL。
本文件用本地表模拟 PocketBase 的 vocabulary_items、word_contexts、
review_events、learning_events。
"""

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent.parent / "learn.db"


def _now() -> str:
    """本地时间，精确到秒。报表里的「今日」按同一时钟的日期比较。"""
    return datetime.now().isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    """每次操作单独连接。row_factory 让结果能按列名读取。"""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """建表。IF NOT EXISTS，重复启动不清空已有数据。"""
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_key   TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vocabulary_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_key   TEXT NOT NULL,
                word       TEXT NOT NULL,
                definition TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (user_key, word),
                FOREIGN KEY (user_key) REFERENCES users(user_key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS word_contexts (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                vocabulary_item_id INTEGER NOT NULL,
                sentence           TEXT NOT NULL,
                media_fingerprint  TEXT NOT NULL,
                subtitle_index     INTEGER NOT NULL,
                start_seconds      REAL NOT NULL,
                FOREIGN KEY (vocabulary_item_id) REFERENCES vocabulary_items(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS review_events (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                user_key           TEXT NOT NULL,
                vocabulary_item_id INTEGER NOT NULL,
                rating             TEXT NOT NULL CHECK (rating IN ('forgot', 'vague', 'remembered')),
                reviewed_at        TEXT NOT NULL,
                duration_ms        INTEGER,
                FOREIGN KEY (user_key) REFERENCES users(user_key),
                FOREIGN KEY (vocabulary_item_id) REFERENCES vocabulary_items(id)
            )
            """
        )
        # 独立行为事件表：谁、何时、对什么、做了什么。不存姓名等敏感信息。
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS learning_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_key    TEXT NOT NULL,
                event_type  TEXT NOT NULL CHECK (
                    event_type IN (
                        'word_saved', 'word_lookup', 'review_submitted',
                        'hint_requested', 'translation_revealed', 'sentence_replayed'
                    )
                ),
                target_type TEXT NOT NULL CHECK (
                    target_type IN ('vocabulary_item', 'word_context', 'subtitle', 'media')
                ),
                target_id   TEXT NOT NULL,
                payload     TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (user_key) REFERENCES users(user_key)
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_vocabulary_user ON vocabulary_items(user_key)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_contexts_item ON word_contexts(vocabulary_item_id)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reviews_user ON review_events(user_key)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_reviews_item ON review_events(vocabulary_item_id)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_user ON learning_events(user_key)")


def reset_db() -> None:
    """清空业务数据并重置自增 id。测试和课堂演示用。"""
    with _connect() as conn:
        conn.execute("DELETE FROM learning_events")
        conn.execute("DELETE FROM review_events")
        conn.execute("DELETE FROM word_contexts")
        conn.execute("DELETE FROM vocabulary_items")
        conn.execute("DELETE FROM users")
        # 表名是固定字面量；sqlite_sequence 在第一次自增插入后才出现。
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
        ).fetchone()
        if exists is not None:
            conn.execute(
                """
                DELETE FROM sqlite_sequence
                WHERE name IN ('learning_events', 'review_events', 'word_contexts', 'vocabulary_items', 'users')
                """
            )


def _ensure_user(conn: sqlite3.Connection, user_key: str, now: str) -> None:
    conn.execute(
        """
        INSERT INTO users (user_key, created_at) VALUES (?, ?)
        ON CONFLICT(user_key) DO NOTHING
        """,
        (user_key, now),
    )


def _contexts_of(conn: sqlite3.Connection, vocabulary_item_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, vocabulary_item_id, sentence, media_fingerprint, subtitle_index, start_seconds
        FROM word_contexts
        WHERE vocabulary_item_id = ?
        ORDER BY id
        """,
        (vocabulary_item_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _vocabulary_from_row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["contexts"] = _contexts_of(conn, item["id"])
    return item


def save_vocabulary_item(
    user_key: str,
    word: str,
    definition: str,
    contexts: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    保存生词，并写入这次带来的语境。

    同一用户的同一个单词已存在时，不新建词条、不改释义，只追加语境。
    """
    now = _now()
    with _connect() as conn:
        _ensure_user(conn, user_key, now)
        existing = conn.execute(
            """
            SELECT id, user_key, word, definition, created_at
            FROM vocabulary_items
            WHERE user_key = ? AND word = ?
            """,
            (user_key, word),
        ).fetchone()
        if existing is None:
            cur = conn.execute(
                """
                INSERT INTO vocabulary_items (user_key, word, definition, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_key, word, definition, now),
            )
            item_id = cur.lastrowid
        else:
            item_id = existing["id"]
        for ctx in contexts:
            conn.execute(
                """
                INSERT INTO word_contexts (
                    vocabulary_item_id, sentence, media_fingerprint, subtitle_index, start_seconds
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    ctx["sentence"],
                    ctx["media_fingerprint"],
                    ctx["subtitle_index"],
                    ctx["start_seconds"],
                ),
            )
        saved = conn.execute(
            """
            SELECT id, user_key, word, definition, created_at
            FROM vocabulary_items
            WHERE id = ?
            """,
            (item_id,),
        ).fetchone()
        return _vocabulary_from_row(conn, saved)


def get_vocabulary_item(vocabulary_item_id: int) -> dict[str, Any] | None:
    """按 id 取词条和语境。不存在返回 None，由接口层决定 404。"""
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id, user_key, word, definition, created_at
            FROM vocabulary_items
            WHERE id = ?
            """,
            (vocabulary_item_id,),
        ).fetchone()
        if row is None:
            return None
        return _vocabulary_from_row(conn, row)


def insert_review_event(
    user_key: str,
    vocabulary_item_id: int,
    rating: str,
    duration_ms: int | None,
) -> dict[str, Any] | None:
    """
    写入一次复习评分。

    词条不存在，或不属于这个 user_key 时返回 None，并且不创建新用户。
    reviewed_at 在这里生成。
    """
    now = _now()
    with _connect() as conn:
        owned = conn.execute(
            "SELECT id FROM vocabulary_items WHERE id = ? AND user_key = ?",
            (vocabulary_item_id, user_key),
        ).fetchone()
        if owned is None:
            return None
        cur = conn.execute(
            """
            INSERT INTO review_events (
                user_key, vocabulary_item_id, rating, reviewed_at, duration_ms
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (user_key, vocabulary_item_id, rating, now, duration_ms),
        )
        return {
            "id": cur.lastrowid,
            "user_key": user_key,
            "vocabulary_item_id": vocabulary_item_id,
            "rating": rating,
            "reviewed_at": now,
            "duration_ms": duration_ms,
        }


def list_review_events(user_key: str) -> list[dict[str, Any]]:
    """按匿名用户取出全部复习记录，时间顺序即插入顺序。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, user_key, vocabulary_item_id, rating, reviewed_at, duration_ms
            FROM review_events
            WHERE user_key = ?
            ORDER BY id
            """,
            (user_key,),
        ).fetchall()
        return [dict(row) for row in rows]


def list_review_queue(user_key: str) -> list[dict[str, Any]]:
    """
    该用户当前到期的生词。

    规则是固定间隔，用来让首页看得到队列；正式产品的下次到期仍应按
    review_events 历史做 FSRS，不在本作业实现。
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                v.id,
                v.user_key,
                v.word,
                v.definition,
                latest.rating AS last_rating,
                latest.reviewed_at AS last_reviewed_at
            FROM vocabulary_items v
            LEFT JOIN review_events latest
                ON latest.id = (
                    SELECT MAX(r2.id)
                    FROM review_events r2
                    WHERE r2.vocabulary_item_id = v.id
                )
            WHERE v.user_key = ?
              AND (
                    latest.id IS NULL
                    OR latest.rating = 'forgot'
                    OR (
                        latest.rating = 'vague'
                        AND replace(latest.reviewed_at, 'T', ' ')
                            <= datetime('now', 'localtime', '-1 day')
                    )
                    OR (
                        latest.rating = 'remembered'
                        AND replace(latest.reviewed_at, 'T', ' ')
                            <= datetime('now', 'localtime', '-3 days')
                    )
              )
            ORDER BY v.id
            """,
            (user_key,),
        ).fetchall()
        return [dict(row) for row in rows]


def insert_learning_event(
    user_key: str,
    event_type: str,
    target_type: str,
    target_id: str,
    payload: str,
) -> dict[str, Any]:
    """写入一条行为事件。新的 user_key 会先进入 users，以便报表能看到这个人。"""
    now = _now()
    with _connect() as conn:
        _ensure_user(conn, user_key, now)
        cur = conn.execute(
            """
            INSERT INTO learning_events (
                user_key, event_type, target_type, target_id, payload, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_key, event_type, target_type, target_id, payload, now),
        )
        return {
            "id": cur.lastrowid,
            "user_key": user_key,
            "event_type": event_type,
            "target_type": target_type,
            "target_id": target_id,
            "payload": payload,
            "created_at": now,
        }


def list_learning_events(limit: int = 100) -> list[dict[str, Any]]:
    """最近写入的行为事件，供报表页展示采集结果。"""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, user_key, event_type, target_type, target_id, payload, created_at
            FROM learning_events
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def report_overview() -> list[dict[str, Any]]:
    """
    每个匿名用户一行学习统计。

    左表是 users。词条数、复习次数各自聚合后再 LEFT JOIN，
    避免「多条词条 × 多条复习」把平均时长乘大。
    没有复习的用户复习次数为 0，记得比例和平均时长为 NULL。
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                u.user_key AS user_key,
                COALESCE(vc.vocabulary_count, 0) AS vocabulary_count,
                COALESCE(rs.review_count, 0) AS review_count,
                COALESCE(rs.today_completed, 0) AS today_completed,
                rs.remembered_ratio_7d AS remembered_ratio_7d,
                rs.avg_duration_ms AS avg_duration_ms
            FROM users u
            LEFT JOIN (
                SELECT user_key, COUNT(*) AS vocabulary_count
                FROM vocabulary_items
                GROUP BY user_key
            ) vc ON vc.user_key = u.user_key
            LEFT JOIN (
                SELECT
                    user_key,
                    COUNT(*) AS review_count,
                    SUM(
                        CASE
                            WHEN substr(reviewed_at, 1, 10) = date('now', 'localtime') THEN 1
                            ELSE 0
                        END
                    ) AS today_completed,
                    CASE
                        WHEN SUM(
                            CASE
                                WHEN replace(reviewed_at, 'T', ' ')
                                     >= datetime('now', 'localtime', '-7 days') THEN 1
                                ELSE 0
                            END
                        ) = 0 THEN NULL
                        ELSE ROUND(
                            CAST(
                                SUM(
                                    CASE
                                        WHEN replace(reviewed_at, 'T', ' ')
                                             >= datetime('now', 'localtime', '-7 days')
                                         AND rating = 'remembered' THEN 1
                                        ELSE 0
                                    END
                                ) AS REAL
                            )
                            / SUM(
                                CASE
                                    WHEN replace(reviewed_at, 'T', ' ')
                                         >= datetime('now', 'localtime', '-7 days') THEN 1
                                    ELSE 0
                                END
                            ),
                            4
                        )
                    END AS remembered_ratio_7d,
                    ROUND(AVG(duration_ms), 1) AS avg_duration_ms
                FROM review_events
                GROUP BY user_key
            ) rs ON rs.user_key = u.user_key
            ORDER BY u.user_key
            """
        ).fetchall()
        report = [dict(row) for row in rows]
    for row in report:
        row["due_count"] = len(list_review_queue(row["user_key"]))
    return report
