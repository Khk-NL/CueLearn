# CueLearn 课程业务接口

> **2026-10-20 更新（Yan）**：下方原 `/learners`、`/review-events` 接口说明对应已合并的初版实现。  
> 当前仓库以生词 / 复习 / **`POST /events` 行为采集** / **LEFT JOIN 报表** 为准，请改看：  
> - 采集与统计证据：`project-docs/数据采集与展示记录.md`  
> - 交互文档：`uv run fastapi dev app/main.py --host 127.0.0.1 --port 8011` → http://127.0.0.1:8011/docs  

---

本次将 `app/main.py` 从职责骨架实现为六个可运行的 FastAPI 接口，每个业务路由均在装饰器中显式声明 `response_model`。请求模型与返回模型分开，路由只编排请求、存储和错误，不直接拼装 SQL。

## 实现边界

本服务按本次任务明确授权的范围，用 SQLite 保存匿名参与者和复习学习事件，供本机课程演示。现有 PocketBase 继续保存桌面端账号、生词及 FSRS 排程；本服务不复制、同步或更新这些业务事实。

这不是原先已确定的全组架构，也不是已完成的桌面事件采集集成。HTTP 请求需要由调用方在复习成功提交后发送；取消、未完成或业务提交失败时不发送。`duration_ms` 由调用方提供，本服务只验证和保存，不假装已经实现桌面计时。匿名 UUID 不是认证凭据，本服务没有鉴权，应只在可信本机环境中监听 `127.0.0.1`。

仓库和可查历史中未提供可运行的 Student/Enrollment Python 模板，因此此处采用 FastAPI 模型化 JSON 返回，以及标准 `HTTPException` / 422 错误格式。学习对象 `object_id` 是不含路径的外部标识；本服务不访问 PocketBase，也不声称校验了词条归属。

## 安装与运行

需要 Python 3.11 或以上版本和 [uv](https://docs.astral.sh/uv/getting-started/installation/)。在仓库根目录执行：

```powershell
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

打开 `http://127.0.0.1:8000/docs` 操作接口；OpenAPI 地址为 `http://127.0.0.1:8000/openapi.json`。若已建立 `.venv` 但终端尚未安装 uv，Windows 可以使用 `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000` 启动已安装的服务。

默认数据库为运行目录下 `.local/course-api/learn.db`，不会自动读取根目录的既有 `learn.db` 或 PocketBase 数据。可显式指定独立课程数据库：

```powershell
$env:CUELEARN_API_DB = "C:\course-demo\learn.db"
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

环境变量为空时报错；没有静默回退。仅导入模块不建库，应用启动时初始化表。每次存储操作提交或回滚后关闭连接，应用关闭时释放存储引用。请勿将配置指向真实业务数据库。数据库与 `.venv` 已由仓库忽略。

## 接口表

| 方法 | 路径 | 请求模型 | response_model | 成功状态 |
| --- | --- | --- | --- | --- |
| POST | `/learners` | `LearnerCreate` | `LearnerRead` | 201 |
| GET | `/learners` | 无 | `list[LearnerRead]` | 200 |
| POST | `/review-events` | `ReviewEventCreate` | `ReviewEventRead` | 新建201，相同重试200 |
| GET | `/review-events` | 查询参数 | `list[ReviewEventRead]` | 200 |
| GET | `/review-events/{event_id}` | UUID路径参数 | `ReviewEventRead` | 200 |
| GET | `/stats/learners` | 无 | `list[LearnerStatsRead]` | 200 |

事件列表按 `occurred_at`、`id` 升序返回。可使用可选的 `learner_id` UUID 筛选，`limit` 默认为100，范围1至500；`offset` 默认为0，范围0至2147483647。已注册但没有事件的参与者返回空事件列表；未注册的参与者筛选返回404。参与者列表与统计返回完整注册范围，本机课程规模使用，不作为公网大数据分页方案。

## 注册与提交示例

首先 `POST /learners`，请求体为 `{}`。这是有意不收集个人资料的 `LearnerCreate`；额外字段会返回422。响应示例中的 UUID 和时间均为合成数据：

```json
{
  "id": "0b9a7d9f-1673-4d01-b05b-dd4f89aa5bc9",
  "created_at": "2026-10-20T00:00:00Z"
}
```

使用实际注册响应中的 `id` 提交 `POST /review-events`：

```json
{
  "learner_id": "0b9a7d9f-1673-4d01-b05b-dd4f89aa5bc9",
  "object_id": "word:lesson_01",
  "action": "review_submitted",
  "occurred_at": "2026-10-20T08:00:00+08:00",
  "rating": "remembered",
  "duration_ms": 12000,
  "client_event_id": "da935323-2457-449e-84c5-f2ffefc43b62"
}
```

`learner_id`、`client_event_id` 必须是 UUID。`object_id` 长度1至128，只接受字母、数字、冒号、下划线和连字符，且首字符为字母或数字；不要使用真实个人信息。`action` 可省略，默认且仅支持 `review_submitted`。`rating` 仅接受 `forgot`、`unsure`、`remembered`。

`occurred_at` 必须为带时区的 ISO 日期字符串，保存及返回时转换为 UTC；不接受无时区日期或数字时间戳。`duration_ms` 必须是0至2147483647之间的 JSON 整数，单位毫秒，约24.9天为技术上限；字符串、布尔值、小数和空值都不接受。0表示实际记录为零，不能用来补齐没有采集的时长。

成功响应包括全部已验证事件字段，以及服务端生成的 `id` 和 `received_at`。例如：

```json
{
  "id": "9883a2a6-24cf-4584-b361-a49b02f7305c",
  "learner_id": "0b9a7d9f-1673-4d01-b05b-dd4f89aa5bc9",
  "object_id": "word:lesson_01",
  "action": "review_submitted",
  "occurred_at": "2026-10-20T00:00:00Z",
  "rating": "remembered",
  "duration_ms": 12000,
  "client_event_id": "da935323-2457-449e-84c5-f2ffefc43b62",
  "received_at": "2026-10-20T00:00:01Z"
}
```

Create 不接收服务端 `id`、`received_at` 或其他额外字段。客户端需保存实际返回的匿名参与者标识；每次注册都会创建新的参与者，不等同于 PocketBase 登录。

## 错误与事件去重

- 合法 UUID 但事件或关联参与者不存在：404，例如 `{"detail":"复习事件不存在"}`。
- 格式错误、缺失必填字段、非法评分或负时长：422，`detail` 为标准验证错误数组。例如负时长会包含 `{"type":"greater_than_equal","loc":["body","duration_ms"],"msg":"Input should be greater than or equal to 0","input":-1,"ctx":{"ge":0}}`。
- 已存在的 `(learner_id, client_event_id)` 与新内容冲突：409，例如 `{"detail":"client_event_id 已用于不同内容的复习事件"}`。

同一参与者重试同一事件，必须复用 `client_event_id` 和原始内容。相同内容返回原记录和200，不改变事件 ID 或接收时间；同一时刻的等价时区表示也视为相同。内容不同则409，不覆盖原记录。不同参与者可以使用相同的客户端事件标识。唯一约束与单条冲突处理 SQL 保证并发重试不会重复写入。

外部值全部通过 `?` 参数传入。事件表包含外键和独立的去重约束，没有通用 JSON 元数据入口，不接收密码、令牌或视频路径。

## 学习统计口径

统计查询以完整 `learners` 表为起点，`LEFT JOIN review_events`。每条已接受的去重事件计一次，重复词条的不同复习仍分别计次。时长表示调用方报告的有效作答时长，不代表全部视频观看时间。

| 字段 | 有事件 | 零事件 |
| --- | --- | --- |
| `review_count` | 事件数量 | 0 |
| `total_duration_ms` | 事件毫秒时长之和 | 0 |
| `average_duration_ms` | 每次事件平均毫秒数 | null |
| `remembered_rate` | remembered事件数 / 事件数，范围0至1 | null |

例如同一参与者的三条事件评分依次为forgot、unsure、remembered，时长为1000、2000、3000毫秒，则次数3、累计6000、平均2000、记得比例约0.3333。另一个已注册但没有事件的参与者也返回，次数与累计为0，其余为null。记得比例属于自评，不是客观测验正确率。

## 验证方法与限制

```powershell
uv run pytest -v
```

测试通过临时文件 SQLite 验证真实创建、查询、404/422、409冲突、UTC归一化、分页、重试与并发去重、跨应用重启持久化、零参与者统计、响应额外字段过滤，以及所有业务装饰器显式声明模型。不会使用真实用户数据库，也不靠 mock 仓储或空测试给出成功结论。

HTTP 实机演示流程为：启动服务 → 注册两名匿名参与者 → 为其中一人提交事件 → 查询单条事件与列表 → 重试同一事件 → 查看两人的统计 → 关闭服务。实际执行结果以本次交付报告为准。

本次没有修改桌面端、PocketBase 或 FSRS，未验收真实桌面操作到 HTTP 的事件采集、账号映射或生产鉴权；不能把课程 HTTP 验证视为桌面端完整测试通过。
