"""课程服务的独立 SQLite 存储，不读取或同步 PocketBase 业务状态。"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from uuid import UUID, uuid4

from app.models import ReviewEventCreate


class LearnerNotFoundError(LookupError):
    """事件或筛选条件引用了本服务中不存在的匿名参与者。"""


class EventConflictError(ValueError):
    """同一参与者的去重标识已被其他事件内容使用。"""


class LearningStorage:
    """管理课程数据库路径，每次操作在独立连接中提交或回滚并关闭连接。"""

    def __init__(self, database_path: Path) -> None:
        """记录数据库路径，构造过程不创建目录、数据库或连接。"""
        self.database_path = database_path

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        """开启带外键检查的真实连接，成功提交，异常回滚，退出时始终关闭。"""
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        """在应用启动时建立匿名参与者和事件表，不接触其他数据库。"""
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS learners (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS review_events (
                    id TEXT PRIMARY KEY,
                    learner_id TEXT NOT NULL REFERENCES learners(id),
                    object_id TEXT NOT NULL,
                    action TEXT NOT NULL CHECK (action = 'review_submitted'),
                    occurred_at TEXT NOT NULL,
                    rating TEXT NOT NULL CHECK (rating IN ('forgot', 'unsure', 'remembered')),
                    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 2147483647),
                    client_event_id TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    UNIQUE (learner_id, client_event_id)
                );
                CREATE INDEX IF NOT EXISTS idx_review_events_order
                    ON review_events (occurred_at, id);
                """
            )

    def create_learner(self) -> dict[str, object]:
        """为一次匿名注册生成 UUID 和 UTC 时间，并保存后返回记录。"""
        learner_id = str(uuid4())
        with self._connection() as connection:
            row = connection.execute(
                "INSERT INTO learners (id, created_at) VALUES (?, ?) RETURNING *",
                (learner_id, datetime.now(timezone.utc).isoformat()),
            ).fetchone()
            return dict(row)

    def learners(self) -> list[dict[str, object]]:
        """按注册时间和标识返回完整匿名参与者范围，包括零事件参与者。"""
        with self._connection() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM learners ORDER BY created_at, id")]

    def _require_learner(self, connection: sqlite3.Connection, learner_id: str) -> None:
        """核对事件归属或查询筛选引用的匿名参与者存在，否则抛出领域异常。"""
        if connection.execute("SELECT id FROM learners WHERE id = ?", (learner_id,)).fetchone() is None:
            raise LearnerNotFoundError("匿名参与者不存在")

    def save_event(self, event: ReviewEventCreate) -> tuple[dict[str, object], bool]:
        """保存事件；唯一约束保证重试不重复写入，同键不同内容抛出冲突。"""
        values = (
            str(event.learner_id), event.object_id, event.action,
            event.occurred_at.isoformat(), event.rating, event.duration_ms, str(event.client_event_id),
        )
        with self._connection() as connection:
            self._require_learner(connection, values[0])
            row = connection.execute(
                """
                INSERT INTO review_events
                    (id, learner_id, object_id, action, occurred_at, rating, duration_ms, client_event_id, received_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (learner_id, client_event_id) DO NOTHING
                RETURNING *
                """,
                (str(uuid4()), *values, datetime.now(timezone.utc).isoformat()),
            ).fetchone()
            if row is not None:
                return dict(row), True
            existing = connection.execute(
                "SELECT * FROM review_events WHERE learner_id = ? AND client_event_id = ?",
                (values[0], values[-1]),
            ).fetchone()
            keys = ("learner_id", "object_id", "action", "occurred_at", "rating", "duration_ms", "client_event_id")
            if tuple(existing[key] for key in keys) != values:
                raise EventConflictError("client_event_id 已用于不同内容的复习事件")
            return dict(existing), False

    def events(self, learner_id: UUID | None, limit: int, offset: int) -> list[dict[str, object]]:
        """按发生时间分页查询事件；有参与者筛选时先校验其存在。"""
        with self._connection() as connection:
            if learner_id is not None:
                self._require_learner(connection, str(learner_id))
                rows = connection.execute(
                    "SELECT * FROM review_events WHERE learner_id = ? ORDER BY occurred_at, id LIMIT ? OFFSET ?",
                    (str(learner_id), limit, offset),
                )
            else:
                rows = connection.execute(
                    "SELECT * FROM review_events ORDER BY occurred_at, id LIMIT ? OFFSET ?", (limit, offset),
                )
            return [dict(row) for row in rows]

    def event(self, event_id: UUID) -> dict[str, object] | None:
        """读取单条事件，合法但不存在的标识返回空值，交由路由映射为404。"""
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM review_events WHERE id = ?", (str(event_id),)).fetchone()
            return dict(row) if row is not None else None

    def stats(self) -> list[dict[str, object]]:
        """从完整参与者范围左连接事件，缺少事件时保留空平均值和空记得比例。"""
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT learners.id AS learner_id,
                       COUNT(review_events.id) AS review_count,
                       COALESCE(SUM(review_events.duration_ms), 0) AS total_duration_ms,
                       AVG(review_events.duration_ms) AS average_duration_ms,
                       AVG(CASE WHEN review_events.id IS NULL THEN NULL
                                WHEN review_events.rating = 'remembered' THEN 1.0 ELSE 0.0 END) AS remembered_rate
                FROM learners
                LEFT JOIN review_events ON review_events.learner_id = learners.id
                GROUP BY learners.id
                ORDER BY learners.created_at, learners.id
                """
            )
            return [dict(row) for row in rows]
