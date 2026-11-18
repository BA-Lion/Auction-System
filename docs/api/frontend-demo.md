# 前端 Demo HTTP 与 WebSocket 契约草案

适用于共享本地模拟服务及后续正式服务。2026-11-18 已确认演示方式、大厅范围、出价规则，以及大厅和竞拍页均提供手动刷新按钮。以下路径、字段、鉴权方式及其余交互细节供评审。

## 通用约定

- HTTP 前缀为 `/api/v1`，JSON 使用 snake_case。下文的 ID 均为字符串。金额为整数分，请求金额须为正、安全整数；余额可为零，流水变化可为负。版本为非负安全整数，时间为 UTC 毫秒字符串，例如 `2026-11-18T07:00:00.000Z`。
- 建议游客可浏览大厅、场次详情和公开榜单。登录通过同源 HttpOnly 会话 Cookie 同时认证 HTTP 和 WS。所有写入及本人数据接口要求登录（注册、登录除外）；卖家、报名人和付款人按会话确定。状态变更请求校验同源。建议榜单展示昵称，用户通过公开的 user_id 与自己的 ID 判断哪些报价属于自己。
- 成功响应直接返回资源；新建资源用 201，查询、更新及返回已有结果用 200，空成功用 204。集合返回 `{items, next_cursor}`，末页游标为 null。下表中 `?` 表示可省略，`| null` 表示返回键存在但可以为空。
- 失败统一返回 `{"error":{"code":"BID_TOO_LOW","message":"报价至少为 100.01 元","details":{"minimum_amount":10001}}}`。客户端按 code 分支。通用失败包括 400 INVALID_ARGUMENT、401 AUTH_REQUIRED、403 FORBIDDEN、404 NOT_FOUND。

## 账号、钱包、发布

| 操作 | 请求 | 成功响应与重试 |
| --- | --- | --- |
| POST /auth/register | username、password、nickname，均为字符串 | 201 User，同时创建零余额钱包。重名 409 USERNAME_TAKEN。注册后可用登录接口建立会话。 |
| POST /auth/login | username、password | 200 User，设置会话。失败 401 INVALID_CREDENTIALS。 |
| POST /auth/logout；GET /me | 空 | 退出 204 并使会话失效；查询返回 200 User。User 为 user_id、username、nickname，仅本人可见 username。 |
| GET /me/wallet | 无 | 200 `{balance, frozen_balance}`。 |
| POST /me/wallet/top-ups | `{"amount":50000}`，Idempotency-Key 请求头 | 201 `{top_up_id, flow_id, amount}`。同用户、同键、同金额重试返回 200 原结果，同键异额返回 409 IDEMPOTENCY_CONFLICT。 |
| GET /me/fund-flows | cursor? | 本人流水按发生时间倒序。每条含 flow_id、type、biz_id、amount、balance_delta、frozen_delta、created_at。用户可见 type 为 TOP_UP、DEPOSIT_FREEZE、DEPOSIT_RELEASE、PURCHASE、SALE_SETTLEMENT、DEPOSIT_FORFEIT、DEFAULT_COMPENSATION。平台收入另行记账。 |
| POST /lots；GET /me/lots | 创建传 title、description、category_code（字符串）；images? 为 URL 字符串数组，默认空。查询传 cursor? | 创建 201 Lot；查询返回本人 Lot 集合。Lot 含 lot_id、seller_id、title、description、category_code、images、status、current_round_id（可空）。status 为 AVAILABLE、PENDING_DEAL、SOLD。 |
| POST /lots/{lot_id}/rounds | `{start_price,duration_seconds,starts_at?}`，时长为正整数秒。Idempotency-Key 请求头 | 拍品所有者可建场。立即场采用服务端当前时间，预约时间须在未来。201 `{lot_id,round_id,status,starts_at,ends_at}`。同用户同次建场重试返回 200 原场次，同键异参返回 409 IDEMPOTENCY_CONFLICT。建议已有待开拍／进行中场次、待付款或已售时返回 409 LOT_UNAVAILABLE；流拍收尾后恢复 AVAILABLE 可重拍，新建 round_id。 |

## 大厅与历史

本地 Demo 的卖家列表为每件拍品补充布尔字段 `can_schedule`。卖家中心据此显示“创建场次”，已预约的拍品可直接进入当前场次。大厅条目可携带 `images` 数组（含预置拍品图）。

| 操作 | 请求 | 结果 |
| --- | --- | --- |
| GET /rounds | 首页 q?、category_code?、status?（WAITING 或 RUNNING）、limit?；以后仅传 cursor | 公开大厅，首页固定查询时刻及排序。仅包含当时尚未到截止、可预报名或参与的场次；已保存但未建场的拍品在卖家的拍品列表查看。每项含 round_id、lot_id、title、category_code、status、start_price、current_price（可空）、starts_at、ends_at。建议按 starts_at 降序、round_id 降序稳定排序，默认 20 条。 |
| GET /me/rounds | cursor? | 本人报名过或作为卖家开过的场次。按 starts_at、round_id 倒序，沿用大厅条目字段，可包含 CLOSED。同一拍品的两次拍卖有各自的 round_id，均能回到原场。 |
| GET /rounds/{round_id} | 无 | 200 `{lot, state, server_time}`。state 使用下节完整结构。历史页按原 round_id 查询；重拍不改变旧结果。 |

大厅翻页沿用同次查询视图。游标失效返回 410 CURSOR_EXPIRED，页面提示“列表已过期，刷新查看最新场次”。改条件或刷新从首页重新查询；模拟服务可保存查询结果快照，正式服务按 SEARCH-04～06 使用 PIT。浏览快照不承诺固定五分钟有效期。

## 页面上的“刷新”按钮

| 页面 | 点击后的请求 | 成功后的展示 |
| --- | --- | --- |
| 拍卖大厅 | 保留当前搜索词、分类、状态和排序，以首页参数重新请求 `GET /rounds`，省略旧 cursor，开启新查询快照。 | 用新首页及其 next_cursor 替换已加载的列表。旧查询尚在途的翻页响应到达时丢弃。大厅显示查询服务此时已可见的数据，最新一笔出价仍可能尚未同步到索引。 |
| 竞拍页 | 直接请求 `GET /rounds/{round_id}`。已登录用户同时刷新本页展示的本人报名、近期出价记录；展示订单时也查询 my-order。 | 更新最新价、领先者、Top10、截止、倒计时和关场结果。沿用当前 WS 订阅，按 state_version 合并 HTTP 快照和推送，个人回执按 bid_id 合并。WS 断线时按钮仍可通过 HTTP 获取状态。 |

刷新发起实际服务端读取。两个页面在读取期间保留现有内容并显示“刷新中”；连续点击可合并。某项读取失败时保留该项上次可用内容，提示重试。竞拍页保留用户正在输入的报价金额；刷新操作只查询状态，出价仍须用户单独提交。

## 报名、出价与个人回执

| 操作 | 请求 | 结果 |
| --- | --- | --- |
| GET /rounds/{id}/my-registration | 无 | 200 `{registration: Registration \| null}`。Registration 含 registration_id、round_id、deposit_amount、deposit_status。 |
| POST /rounds/{id}/my-registration | 空对象 | 201 `{registration}`，重复报名返回 200 原记录。押金状态取 FROZEN、RELEASED、APPLIED、FORFEITED。卖家报名 403 OWN_LOT，截止 409 ROUND_ENDED，余额不足 409 INSUFFICIENT_BALANCE。 |
| POST /rounds/{id}/bids | `{"amount":10000}` | 200 裁决回执，示例见下。请求只含金额，bid_id 由服务端生成。报价请求超时或结果未知时查本人近期记录，客户端禁用自动重提。 |
| GET /rounds/{id}/my-bids | cursor? | 按 bid_version 降序返回本人的近期记录。每条含 bid_id、round_id、amount、accepted_at、bid_version、receipt_status。receipt_status 为 RECEIVED、CONFIRMED、PENDING_REVIEW。传输超时且查无匹配记录时只保留本地待核对提示。 |

**示例。** 截止原为 07:00:10，用户在 07:00:00 首报起拍价 100 元。服务端的成功响应为：

```json
{
  "bid_id": "b1", "round_id": "r1", "receipt_status": "RECEIVED",
  "amount": 10000, "accepted_at": "2026-11-18T07:00:00.000Z",
  "current_price": 10000, "leader_user_id": "u2", "leader_bid_id": "b1",
  "bid_version": 1, "deadline_version": 1,
  "ends_at": "2026-11-18T07:00:40.000Z", "extension_count": 1,
  "extended": true, "last_extension": false, "deadline_sync_pending": true
}
```

两人同时首次报 100 元时，同场先裁决的请求成功，后裁决者收到 409 BID_TOO_LOW，details.minimum_amount 为 10001。其余拒绝原因有 409 ROUND_NOT_STARTED、409 ROUND_ENDED、403 NOT_REGISTERED、429 ROUND_BUSY。资格回查故障用 503 ELIGIBILITY_UNAVAILABLE。裁决执行情况无法判定时用 503 BID_OUTCOME_UNKNOWN；无 HTTP 响应也走相同的核对流程。

## 场次快照与推送

`state` 用于详情查询和场次广播，以下字段属于同一版本。

| 字段 | 取值 |
| --- | --- |
| round_id、status、starts_at、ends_at、start_price | status 为 WAITING、RUNNING、CLOSED；倒计时归零可暂时仍为 RUNNING。 |
| state_version、bid_version、deadline_version、extension_count | state_version 为对外展示版本，每次公开场次状态变化都递增，包括单独开场、关场和正式结果就绪。有效报价增加 bid_version，加时增加 deadline_version 及 extension_count。第五次加时广播中 extension_count 为 5。 |
| current_price、leader_bid_id、leader_user_id、ranking | 无有效报价时前三项为 null，ranking 为空数组。有报价时 ranking 按金额降序取前十笔。每项含 bid_id、user_id、nickname、amount、accepted_at。 |
| last_extension | 布尔值。仅在本次更新触发第五次加时时为 true；快照中的 extension_count 可用于持续显示“已达加时上限”。 |
| result | 正式结果尚未可查为 null。无人中拍为 `{"kind":"NO_BIDS"}`。有赢家为 `{kind:"WON",winner_bid_id,winner_user_id,final_price}`。 |

同源 WS 路径为 `/api/v1/ws`。客户端先装好消息处理函数，再发 `{"type":"subscribe","round_id":"r1"}`。服务端登记房间订阅及已登录用户的本场个人订阅，回复 `{"type":"subscribed","round_id":"r1"}`。自登记起发生的更新都可到达客户端，包括快照查询期间的更新。

- `{"type":"round.updated","state":State,"server_time":Time}` 携带完整场次状态。客户端先缓冲，订阅确认后查详情；按 round_id 和 state_version 保留最新状态。回执只更新个人记录并可提示加时，不用旧 HTTP 回执覆盖整榜。
- `{"type":"bid.receipt","record":MyBid}` 仅投递给该报价人。订阅确认后登录用户同时拉取 my-bids。相同 bid_id 合并时，CONFIRMED 优先于其他状态，PENDING_REVIEW 优先于迟到的 RECEIVED。
- 重连重复订阅和快照流程。确认消息可先于 HTTP 回执抵达。断线期间发生关场，即使 bid_version 未变化，新的 state_version 仍可替换旧榜单状态。退出登录关闭连接，切换身份重新订阅。

## 中拍订单与付款

| 操作 | 请求 | 结果 |
| --- | --- | --- |
| GET /rounds/{id}/my-order | 无 | 200 `{availability,order}`。NONE 表示当前用户尚无可展示的订单；CREATING 表示已有正式赢家，交易方正在等待建单；READY 携带 Order，其余 order 为 null。卖家与中拍者可读订单，未中拍者查自己的报名了解解冻进度。 |
| POST /orders/{order_id}/pay | 空对象 | 仅买家可付，200 Order。重复支付已付订单返回 200 原结果。余额不足返回 409 INSUFFICIENT_BALANCE，已过期返回 409 ORDER_EXPIRED。金额与到期时间均取自固定订单。 |

Order 含 order_id、round_id、buyer_id、seller_id、deal_amount、deposit_amount、remaining_amount、expires_at、status、can_pay、paid_at、closed_at、settled_at。后三个时间在对应动作完成前为空。status 为 PENDING_PAYMENT、PAID、EXPIRED。can_pay 按当前身份、订单状态及服务端截止判断；付款时再核验余额。零尾款直接正常成交。付款窗口从竞拍结束起算两小时。订单处理中、押金尚未解冻或付款到期时，前端重新查询订单、报名与钱包。关场广播不能替代这些查询。

## 依据

[竞拍与回执](../confirm-design/02-报名资格与出价裁决.md) · [实时反馈](../confirm-design/03-报价消息与实时反馈.md) · [加时与关场](../confirm-design/04-加时截止同步与关场.md) · [钱包流水](../confirm-design/05-账户与有向流水.md) · [订单结算](../confirm-design/06-订单结算与资金Outbox.md) · [列表分页](../confirm-design/07-列表检索与分页.md)
