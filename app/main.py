"""课程业务 HTTP 入口，只编排匿名复习事件与分析，不改写桌面端复习状态。"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, AsyncIterator
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status

from app.models import LearnerCreate, LearnerRead, LearnerStatsRead, ReviewEventCreate, ReviewEventRead
from app.storage import EventConflictError, LearnerNotFoundError, LearningStorage


def get_storage(request: Request) -> LearningStorage:
    """取得当前应用启动阶段创建的存储对象，各操作自行关闭连接。"""
    return request.app.state.storage


Storage = Annotated[LearningStorage, Depends(get_storage)]


def create_app(database_path: str | Path | None = None) -> FastAPI:
    """创建可独立测试的应用，只在生命周期启动时初始化指定课程数据库。"""

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        """启动时解析数据库配置并初始化，退出时释放存储引用，不持有长期连接。"""
        configured = database_path if database_path is not None else os.environ.get(
            "CUELEARN_API_DB", ".local/course-api/learn.db",
        )
        if not str(configured).strip():
            raise ValueError("CUELEARN_API_DB 不能为空")
        application.state.storage = LearningStorage(Path(configured))
        application.state.storage.initialize()
        try:
            yield
        finally:
            del application.state.storage

    application = FastAPI(
        title="CueLearn 课程学习事件接口",
        description="仅供本机课程演示；匿名标识不提供身份认证，不同步 PocketBase 或 FSRS 状态。",
        lifespan=lifespan,
    )

    @application.post("/learners", response_model=LearnerRead, status_code=status.HTTP_201_CREATED)
    def create_learner(payload: LearnerCreate, storage: Storage) -> dict[str, object]:
        """接收不含个人字段的空对象，返回服务端生成的匿名标识和创建时间。"""
        return storage.create_learner()

    @application.get("/learners", response_model=list[LearnerRead])
    def list_learners(storage: Storage) -> list[dict[str, object]]:
        """返回完整匿名参与者列表，作为事件与零参与者统计的基础范围。"""
        return storage.learners()

    @application.post(
        "/review-events",
        response_model=ReviewEventRead,
        status_code=status.HTTP_201_CREATED,
        responses={200: {"model": ReviewEventRead, "description": "相同事件重试，返回原记录"}},
    )
    def create_review_event(payload: ReviewEventCreate, response: Response, storage: Storage) -> dict[str, object]:
        """持久化已提交的复习事件，相同重试返回200，归属缺失或内容冲突分别报错。"""
        try:
            event, created = storage.save_event(payload)
        except LearnerNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except EventConflictError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if not created:
            response.status_code = status.HTTP_200_OK
        return event

    @application.get("/review-events", response_model=list[ReviewEventRead])
    def list_review_events(
        storage: Storage,
        learner_id: UUID | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 100,
        offset: Annotated[int, Query(ge=0, le=2_147_483_647)] = 0,
    ) -> list[dict[str, object]]:
        """分页查询事件，未知参与者返回404，无匹配事件返回空列表。"""
        try:
            return storage.events(learner_id, limit, offset)
        except LearnerNotFoundError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @application.get("/review-events/{event_id}", response_model=ReviewEventRead)
    def read_review_event(event_id: UUID, storage: Storage) -> dict[str, object]:
        """查询一条已保存事件，不存在返回404，非法UUID由请求验证返回422。"""
        event = storage.event(event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="复习事件不存在")
        return event

    @application.get("/stats/learners", response_model=list[LearnerStatsRead])
    def learner_stats(storage: Storage) -> list[dict[str, object]]:
        """返回包括零事件参与者的复习次数、毫秒时长和自评记得比例。"""
        return storage.stats()

    return application


app = create_app()
