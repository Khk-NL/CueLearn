# CueLearn 课程业务接口

本文对应当前 `app/main.py`、`app/models.py`、`app/storage.py` 的实现。课程服务提供生词与语境、复习记录、独立行为事件及 SQL 学习报表；接口采用下划线路径，例如 `/vocabulary_items` 和 `/review_events`。旧版 `/learners`、`/review-events` 与 UUID 事件协议已不适用。

## 运行边界

课程服务使用独立 SQLite 数据库进行本机课程演示。桌面应用继续通过 Electron IPC 和 PocketBase 保存账号及原有学习数据，本服务没有替代、同步或修改 PocketBase 的功能，也未将桌面按钮操作接入 HTTP 行为采集。

`user_key` 是调用方提供的匿名标识，不是账号、令牌或认证凭据。服务没有鉴权，词条查询和报表不提供生产环境的权限隔离；请只监听可信本机地址 `127.0.0.1`。不要上传真实姓名、邮箱、密码、密钥或本机视频路径。字段格式与敏感键校验不能判断任意文字是否属于个人信息，调用方仍须提供合成演示数据或真正的匿名标识。

## 安装与启动

需要 Python 3.11 及以上版本与 uv。在仓库根目录运行：

```powershell
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 8011
```

打开 `http://127.0.0.1:8011/docs` 查看和调用接口；OpenAPI 地址为 `/openapi.json`，报表网页为 `/report`。

数据库固定为**仓库根目录的 `learn.db`**，与从哪个目录启动无关；启动时创建所需表，重复启动不会清空已有数据。数据库与 Python 缓存已加入 `.gitignore`，不要提交生成的数据。当前没有 `CUELEARN_API_DB` 环境变量配置入口，不应沿用旧说明中的配置方式。

`DELETE /admin/reset` 会清空全部课程表并重置自增编号，只用于合成演示数据。测试使用独立临时数据库并通过 TestClient 生命周期启动服务，不应清空根目录的演示库。

## 接口契约

JSON 业务接口均显式声明 `response_model`；HTML 报表使用 `HTMLResponse`。

| 方法 | 路径 | 入参 | 成功响应 |
| --- | --- | --- | --- |
| GET | `/` | 无 | 200，服务名称、文档与报表地址 |
| GET | `/health` | 无 | 200，`{"status":"ok"}` |
| POST | `/vocabulary_items` | `VocabularyItemCreate` | 201，词条与全部语境，含服务端 ID 和创建时间 |
| GET | `/vocabulary_items/{vocabulary_item_id}` | 正整数词条 ID | 200，词条与语境；不存在为404 |
| POST | `/review_events` | `ReviewEventCreate` | 201，已保存的复习记录 |
| GET | `/review_events?user_key=anon-a` | 匿名用户标识 | 200，`user_key`、`count` 和 `items`；没有记录时为空列表 |
| POST | `/events` | `LearningEventCreate` | 201，已落库的行为事件 |
| GET | `/reports/overview` | 无 | 200，生成时间、用户总数与各用户统计行 |
| GET | `/report/data` | 无 | 200，与 `/reports/overview` 相同的统计结构 |
| GET | `/report` | 无 | 200，用户统计与最近50条行为事件的 HTML 页面 |
| DELETE | `/admin/reset` | 无 | 200，清空课程数据后的提示 |

当前没有 `/events/{id}` HTTP 读取接口。存储层的 `get_learning_event()` 可用于真实落库验证，不能把存储函数当成已提供的路由。

### 收藏生词与语境

在 `/docs` 中调用 `POST /vocabulary_items`，示例：

```json
{
  "user_key": "anon-a",
  "word": "context",
  "definition": "语境",
  "contexts": [
    {
      "sentence": "Keep the word in context.",
      "media_fingerprint": "sha256-demo",
      "subtitle_index": 3,
      "start_seconds": 12.5
    }
  ]
}
```

`contexts` 至少包含一条语境。文字字段去除首尾空白后不能为空；媒体指纹不能包含路径分隔符。字幕序号是非负整数，字幕秒数必须为有限的非负数，不能为无穷大或 NaN。

同一用户收藏同一单词时返回原词条 ID，保留首次释义；精确相同的语境不会重复增加，不同语境追加保存。不同用户收藏相同单词会生成各自的词条。创建请求与响应模型分开，调用方不填写服务端的 `id`、`created_at` 等字段。

### 提交复习与查询

先取得实际创建的词条 ID，再提交 `POST /review_events`：

```json
{
  "user_key": "anon-a",
  "vocabulary_item_id": 1,
  "rating": "remembered",
  "duration_ms": 1800
}
```

`rating` 只能为 `forgot`、`vague`、`remembered`，分别对应忘记、模糊、记得。词条 ID 必须属于提交的 `user_key`，否则返回404且不写入复习记录。`duration_ms` 单位为毫秒，可以省略或为 null，表示未采集时长；0表示实际记录为零，不能用来代替未知时长。

JSON请求中的词条ID、字幕序号和时长使用整数校验，不接受布尔值、字符串或小数冒充整数，并限制在 SQLite 可存储的整数范围内，最大为 `9223372036854775807`；词条 ID 至少为1，时长和字幕序号至少为0。服务端生成 `reviewed_at`，使用本机时间。

查询 `GET /review_events?user_key=anon-a` 返回该匿名标识的记录，按 ID 升序排列。当前没有复习请求幂等键：重复发送有效评分会产生多条记录并计入统计，调用方不能把重试当成自动去重。

### 行为事件采集

`POST /events` 接收独立的行为记录：

```json
{
  "user_key": "anon-a",
  "event_type": "hint_requested",
  "target_type": "subtitle",
  "target_id": "sha256-demo:3",
  "payload": "{\"level\":\"syntax\"}"
}
```

事件由服务端添加 `id` 和 `created_at`，保存到独立的 `learning_events` 表。新匿名标识首次收藏词条或上报行为时会进入 `users` 表，供报表保留完整用户范围。

- `event_type` 可选：`word_saved`、`word_lookup`、`review_submitted`、`hint_requested`、`translation_revealed`、`sentence_replayed`。
- `target_type` 可选：`vocabulary_item`、`word_context`、`subtitle`、`media`。
- `target_id` 是非空业务标识或指纹，不允许本机文件路径。
- `payload` 是 JSON **对象文本**，不是直接嵌套的 JSON 对象；默认是 `"{}"`。不接受非 JSON 文本或数组；嵌套对象、列表中的姓名、邮箱、密码、令牌、密钥等敏感键会被拒绝。

调用收藏和复习接口不会自动写入通用事件表。调用方应在实际业务提交成功后另行上报 `/events`，不要把取消或提交失败标为成功；仅发送 `event_type=review_submitted` 也不会凭空创建复习评分或改变复习统计。桌面端已通过下述原子桥接接口完成自动计时、成功操作采集和匿名账号映射，不再拆成多次独立写入。

## 错误返回

请求模型拒绝未声明字段，避免拼错字段或把服务端生成字段误当成创建参数。422保留 FastAPI 的 `detail` 数组，每条包含 `type`、`loc` 和 `msg`；省略原始输入，避免无穷数值导致错误响应再次序列化失败。

| 情况 | 状态与行为 |
| --- | --- |
| 合法词条 ID 不存在 | 404，`detail` 为不存在提示 |
| 复习词条不存在或不属于给定匿名用户 | 404，不写入复习记录或创建额外用户 |
| 缺少必填字段、非法评分或事件类型 | 422，`detail` 为字段错误数组 |
| 负数、非整数 ID/时长、超出 SQLite 范围或非有限字幕秒数 | 422，不进入数据库写入 |
| 非匿名格式 user_key、文件路径或敏感 payload | 422，不保存该请求 |
| 没有复习记录或报表为空 | 200，空列表，不使用404 |

## 学习统计口径

报表以 `users` 为左表，将词条数和复习数据分别聚合后 `LEFT JOIN`，避免词条与复习记录交叉相乘。只收藏未复习、仅上报行为而未复习的用户都保留一行。返回行按 `user_key` 排序。

| 字段 | 计算方式 | 没有对应数据时 |
| --- | --- | --- |
| `vocabulary_count` | 该用户收藏的词条总数 | 0 |
| `review_count` | 全部已保存复习记录数量 | 0 |
| `today_completed` | `reviewed_at` 的本机日期等于今天的记录数量 | 0 |
| `remembered_ratio_7d` | 最近七天滑动时间窗中 remembered 次数 / 复习次数，保留四位小数 | null |
| `avg_duration_ms` | **全部历史**复习记录中非 null 时长的平均值，保留一位小数；不是近七日平均值 | null |
| `due_count` | 使用课程固定间隔得到的当前到期词条数 | 没有词条时为0 |

“近七日”按本机当前时刻向前七天计算，不是本周或最近七个自然日。`remembered_ratio_7d` 是用户自评记得比例，不是客观测验正确率。通用行为事件只用于最近事件展示，不计入复习次数、平均复习时长或记得比例。

课程到期规则取每个词条最新的复习记录：未复习或最后评分为 forgot 时立即到期；vague 满一天到期；remembered 满三天到期。该规则用于课程展示，不是桌面端的 FSRS 算法，也不会更新 PocketBase 排程。

`/reports/overview` 与 `/report/data` 共用统计逻辑；`/report` 使用相同统计行，并展示最近50条行为事件。生成时间使用服务端本机时钟；直接调用原有接口的记录时间由服务端生成。桌面桥接使用经过校验的客户端实际提交时间（带时区），统一转换为服务端本机时间写入，收据另存接收时间。

## 验证与演示

执行课程 API 测试：

```powershell
uv run pytest -v
```

测试使用临时 SQLite，覆盖真实写入与读取、成功与404/422、跨匿名用户误提交、数值与隐私边界、重复语境、零参与者、统计时间窗、HTML/JSON 口径以及持久化。2026年10月22日补充桌面桥接回归后执行结果为125项通过，无失败、跳过或警告，详见[后端审查与测试验收](../project-docs/后端审查与测试验收.md)。

推荐演示顺序：创建匿名用户 A 的词条 → 为 A 提交复习 → 上报一条匿名行为事件 → 用用户 B 只上报行为 → 查询两个统计 JSON 地址 → 打开 HTML 报表核对 B 的零复习行 → 查询一个不存在的词条 → 提交非法评分观察422。演示仅使用合成数据。

API测试之外，本轮另通过真实 TypeScript 客户端 → Python HTTP → 临时 SQLite → 报表的联调，以及10项桌面针对性测试、TypeScript检查和Vite构建。未运行真实Electron窗口中的完整操作，也未验证远程PocketBase或真实AI；不能据此宣布全部桌面测试通过。


## 桌面原子采集桥接（2026-10-22）

启动 `uv run uvicorn app.main:app --host 127.0.0.1 --port 8011`，在桌面「语境学习」的课程采集地址填写 `http://127.0.0.1:8011` 并保存。此设置独立于PocketBase地址；留空关闭采集，不删除已有记录。「打开课程报表」使用已保存地址。课程服务没有认证，只允许本机HTTP来源，不应开放到公网。

桌面先将收藏或复习提交到PocketBase，再调用 `POST /desktop/captures`。复习时长为卡片可见且没有等待提交的累计时间，单位毫秒；隐藏、提交等待和卸载期间暂停。`unsure` 映射为课程的 `vague`，不改变FSRS。

```json
{
  "user_key": "anon_0123456789abcdef0123456789abcdef",
  "event_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "event_type": "review_submitted",
  "occurred_at": "2026-10-22T02:00:00Z",
  "word": "context",
  "definition": "语境",
  "contexts": [{"sentence": "Words in context.", "media_fingerprint": "demo-sha256", "subtitle_index": 1, "start_seconds": 2}],
  "rating": "vague",
  "duration_ms": 1200
}
```

- `word_saved` 不得携带 `rating` 或 `duration_ms`（包括null）；`review_submitted` 必须提供合法评分和非负安全整数时长。
- 旧词可以没有语境或释义，不为采集编造原句。其他字段仍受请求模型约束。
- 每组PocketBase地址与账号对应一个持久化随机匿名标识及本机盐；发送字段不含邮箱、账号主键、令牌、盐、本机路径或视频标题。词形、释义和原句本身仍可能含个人内容，请使用适宜的学习资料；匿名不等于认证。
- 同一事务保存词条、去重语境、可选复习、行为和 `desktop_captures` 收据。首次201，同一用户同一事件及规范化内容重试200，内容冲突409；校验失败422。收据含 `event_id`、`vocabulary_item_id`、`learning_event_id`、可空 `review_event_id`。
- 事件标识由本机盐和已保存复习记录ID派生；收藏按一次成功动作生成。去重只针对同一事件重传，并不禁止用户之后再次学习同一单词。
- 超时5秒或错误会显示「主业务已保存、采集未确认」。当前没有持久化补发队列，不应为了补采集重新评分。若服务已提交但回执丢失，也不能认定采集一定未落库。
- 该分析副本只采集启用之后的成功收藏与复习，不补录历史、不镜像删除；课程到期算法仍是简化间隔，与PocketBase中的FSRS分开。

真实HTTP联调已核对两个匿名账号、零复习行、重复事件不计两次、内容冲突409以及1200毫秒平均时长。原始日志保存在被忽略的 `.local/`，不含真实账号或用户资料。
