# auction_rounds — 拍卖场次表

整理日期：2026-11-17。依据 [confirm-design v1.1](../confirm-design/README.md)；共同约定与待定边界见 [目录说明](./README.md)。

## 字段

| 字段 | 含义及已确定约束 |
| --- | --- |
| id | 场次主键 |
| item_id | 所属拍品 ID |
| start_price | 起拍价，整数分；当前报名冻结额度依据 |
| starts_at | 开始时间 |
| ends_at | 截止时间，包含加时后的同步结果 |
| deadline_version | 截止版本，用于防止旧同步覆盖新截止 |
| extension_count | 已加时次数 |
| status | 正常状态 WAITING／RUNNING／CLOSED |
| current_price | 已同步的当前报价金额 |
| current_bid_id | 已同步的当前报价 ID |
| current_bidder_id | 已同步的当前出价用户 ID |
| bid_version | 已同步报价版本 |
| winner_bid_id | 正式胜出报价 ID |
| winner_user_id | 正式中拍用户 ID |
| final_price | 正式成交价 |
| closed_at | 关场时间 |
| created_at | 创建时间 |
| updated_at | 修改时间 |

## 约束与业务使用

主键 id。item_id 关联 auction_items.id；一个拍品可以有多个历史场次，重拍创建新场次。

运行中 Redis 是即时裁决位置，本表保存持久化同步结果。current_* 与正式 winner_*／final_price 含义不同，迟到报价不能覆盖正式结果。无人报价时相关报价与胜出字段可空，不把起拍价当作已发生的报价。

正常状态 WAITING → RUNNING → CLOSED；到期但尚未执行关场时可能仍为 RUNNING，Redis Lua 仍按时间拒绝报价。异常与人工暂停状态另行细化。

场次不保存押金冻结状态。CLOSED 不代表全部报名押金已处理完。截止同步、关场交接规则见 confirm-design 的 04；查询索引、版本初始值与各字段精确可空条件待定。
