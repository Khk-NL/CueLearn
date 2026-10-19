"""课程匿名学习服务的请求和响应模型，不包含 PocketBase 认证数据。"""

from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


class LearnerCreate(BaseModel):
    """以空对象注册匿名参与者，拒绝姓名等额外信息，标识由服务端生成。"""

    model_config = ConfigDict(extra="forbid")


class LearnerRead(BaseModel):
    """返回匿名参与者的服务端标识和 UTC 创建时间。"""

    id: UUID
    created_at: AwareDatetime


class ReviewEventCreate(BaseModel):
    """接收一次已提交的复习行为，调用方用稳定的 UUID 标识同一次重试。"""

    model_config = ConfigDict(extra="forbid")

    learner_id: UUID
    object_id: Annotated[
        str,
        Field(
            strict=True,
            min_length=1,
            max_length=128,
            pattern=r"^[A-Za-z0-9][A-Za-z0-9:_-]*$",
            description="不含路径或个人信息的外部学习对象标识，本服务不验证其 PocketBase 归属",
        ),
    ]
    action: Literal["review_submitted"] = "review_submitted"
    occurred_at: AwareDatetime
    rating: Literal["forgot", "unsure", "remembered"]
    duration_ms: Annotated[
        int,
        Field(strict=True, ge=0, le=2_147_483_647, description="有效作答毫秒数，最大为有符号32位整数"),
    ]
    client_event_id: UUID

    @field_validator("occurred_at", mode="before")
    @classmethod
    def require_datetime(cls, value: object) -> object:
        """只接受日期时间或 ISO 日期字符串，不把数字时间戳隐式转换为日期。"""
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value)
            except ValueError as error:
                raise ValueError("occurred_at 必须是带时区的 ISO 日期时间") from error
        if not isinstance(value, (str, datetime)):
            raise ValueError("occurred_at 必须是带时区的 ISO 日期时间")
        return value

    @field_validator("occurred_at")
    @classmethod
    def normalize_utc(cls, value: datetime) -> datetime:
        """将有时区的发生时间转换到 UTC，保证重试比较与排序口径一致。"""
        return value.astimezone(timezone.utc)


class ReviewEventRead(BaseModel):
    """返回已持久化的复习事件及服务端生成的标识和接收时间。"""

    id: UUID
    learner_id: UUID
    object_id: str
    action: Literal["review_submitted"]
    occurred_at: AwareDatetime
    rating: Literal["forgot", "unsure", "remembered"]
    duration_ms: int
    client_event_id: UUID
    received_at: AwareDatetime


class LearnerStatsRead(BaseModel):
    """返回全部匿名参与者的统计；无事件时平均值和记得比例为空。"""

    learner_id: UUID
    review_count: int
    total_duration_ms: int
    average_duration_ms: float | None
    remembered_rate: float | None
