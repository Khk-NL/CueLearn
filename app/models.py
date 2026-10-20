"""
CueLearn 学习数据模型（Pydantic v2）。

提交模型（*Create）只放客户端该传的字段。
返回模型（*Response）带上服务端生成的 id 和时间，不带 users 表的内部行号。
"""

import json
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 匿名标识：字母或数字开头，只允许字母、数字、下划线和连字符。邮箱、姓名放不进来。
USER_KEY_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"

# payload 里出现这些键就拒绝，避免把身份信息混进行为日志。
_SENSITIVE_KEYS = frozenset(
    {"password", "passwd", "email", "phone", "mobile", "real_name", "name", "identity"}
)


class ReviewRating(str, Enum):
    """复习自评。非法值由 Pydantic 直接返回 422。"""

    forgot = "forgot"
    vague = "vague"
    remembered = "remembered"


class LearningEventType(str, Enum):
    """允许上报的学习行为。播放器、ASR、AI 本身不在本作业实现。"""

    word_saved = "word_saved"
    word_lookup = "word_lookup"
    review_submitted = "review_submitted"
    hint_requested = "hint_requested"
    translation_revealed = "translation_revealed"
    sentence_replayed = "sentence_replayed"


class TargetType(str, Enum):
    """行为作用在哪一类对象上。"""

    vocabulary_item = "vocabulary_item"
    word_context = "word_context"
    subtitle = "subtitle"
    media = "media"


def _reject_sensitive(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in _SENSITIVE_KEYS:
                raise ValueError("payload 不得包含姓名、邮箱、密码等敏感字段")
            _reject_sensitive(item)
    elif isinstance(value, list):
        for item in value:
            _reject_sensitive(item)


class WordContextCreate(BaseModel):
    """收藏生词时一并提交的一条语境。"""

    sentence: str = Field(min_length=1, max_length=1000, description="字幕原句")
    media_fingerprint: str = Field(min_length=1, max_length=128, description="视频内容指纹，不是本机路径")
    subtitle_index: int = Field(ge=0, description="字幕序号，从 0 开始")
    start_seconds: float = Field(ge=0, description="该句起始秒数")

    @field_validator("sentence", "media_fingerprint")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("media_fingerprint")
    @classmethod
    def fingerprint_is_not_a_path(cls, value: str) -> str:
        if "/" in value or "\\" in value:
            raise ValueError("媒体指纹不能是本机文件路径")
        return value


class WordContextResponse(BaseModel):
    """返回的语境。id 由数据库生成。"""

    id: int
    vocabulary_item_id: int
    sentence: str
    media_fingerprint: str
    subtitle_index: int
    start_seconds: float


class VocabularyItemCreate(BaseModel):
    """对应确认单 learning/word/save：单词、释义和至少一条语境。"""

    user_key: str = Field(pattern=USER_KEY_PATTERN, description="匿名用户标识")
    word: str = Field(min_length=1, max_length=80, description="单词或短语")
    definition: str = Field(min_length=1, max_length=500, description="释义")
    contexts: list[WordContextCreate] = Field(min_length=1, description="这次收藏带上的语境")

    @field_validator("word", "definition")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class VocabularyItemResponse(BaseModel):
    """词条及其全部语境。不含用户表内部 id。"""

    id: int
    user_key: str
    word: str
    definition: str
    created_at: str = Field(description="第一次收藏的时间，服务端生成")
    contexts: list[WordContextResponse]


class ReviewEventCreate(BaseModel):
    """对应确认单 learning/review。reviewed_at 不由客户端提交。"""

    user_key: str = Field(pattern=USER_KEY_PATTERN, description="匿名用户标识")
    vocabulary_item_id: int = Field(description="词条 id，对应确认单里的 wordId")
    rating: ReviewRating
    duration_ms: int | None = Field(default=None, ge=0, description="作答时长（毫秒），扩展字段，可不传")


class ReviewEventResponse(BaseModel):
    """已保存的复习作答。"""

    model_config = ConfigDict(use_enum_values=True)

    id: int
    user_key: str
    vocabulary_item_id: int
    rating: ReviewRating
    reviewed_at: str = Field(description="作答时间，服务端生成")
    duration_ms: int | None = None


class ReviewEventList(BaseModel):
    """某个用户的复习记录。"""

    user_key: str
    count: int
    items: list[ReviewEventResponse]


class LearningEventCreate(BaseModel):
    """一条行为事件。payload 是 JSON 对象文本。"""

    user_key: str = Field(pattern=USER_KEY_PATTERN, description="匿名用户标识")
    event_type: LearningEventType
    target_type: TargetType
    target_id: str = Field(min_length=1, max_length=128, description="对象标识")
    payload: str = Field(default="{}", max_length=2000, description="附加上下文，JSON 对象文本")

    @field_validator("target_id")
    @classmethod
    def strip_target_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("对象标识不能为空")
        return value

    @field_validator("payload")
    @classmethod
    def payload_must_be_safe_json_object(cls, value: str) -> str:
        try:
            parsed: Any = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("payload 必须是 JSON 文本") from exc
        if not isinstance(parsed, dict):
            raise ValueError("payload 必须是 JSON 对象")
        _reject_sensitive(parsed)
        return value


class LearningEventResponse(BaseModel):
    """已落库的行为事件。"""

    model_config = ConfigDict(use_enum_values=True)

    id: int
    user_key: str
    event_type: LearningEventType
    target_type: TargetType
    target_id: str
    payload: str
    created_at: str


class UserOverviewRow(BaseModel):
    """一个匿名用户的学习概况。没复习过的用户也会有一行。"""

    user_key: str
    vocabulary_count: int = Field(description="收藏的词条数")
    review_count: int = Field(description="复习次数")
    today_completed: int = Field(description="今天完成的复习次数")
    remembered_ratio_7d: float | None = Field(description="近七日记得比例；近七日没有复习时为 null")
    avg_duration_ms: float | None = Field(description="平均作答时长（毫秒）；没有时长数据时为 null")
    due_count: int = Field(description="按简化间隔算出的到期词条数，不是 FSRS")


class OverviewReport(BaseModel):
    """学习统计报表，对应确认单 learning/overview 的统计部分。"""

    generated_at: str
    total_users: int
    rows: list[UserOverviewRow]


class RootResponse(BaseModel):
    message: str
    docs: str
    report: str


class HealthResponse(BaseModel):
    status: str


class MessageResponse(BaseModel):
    message: str
