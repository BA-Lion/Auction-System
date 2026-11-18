# auction_bids — 有效出价记录表

整理日期：2026-11-17。依据 [confirm-design v1.1](../confirm-design/README.md)；共同约定与待定边界见 [目录说明](./README.md)。

## 字段

| 字段 | 含义及已确定约束 |
| --- | --- |
| bid_id | 报价主键，消息重投幂等身份 |
| round_id | 所属场次 ID |
| user_id | 报价用户 ID |
| amount | 有效报价金额，整数分 |
| bid_version | 场次报价版本 |
| accepted_at | Redis 接受并裁决报价的时间 |
| created_at | 报价记录落库时间 |

## 约束与业务使用

主键 bid_id。仅存已被出价 Lua 接受的有效报价，由 Kafka 消费链路异步落库。

已讨论的索引方向：普通索引 (round_id, bid_version)、(round_id, user_id, accepted_at, bid_id)。bid_version 暂不设唯一约束，以 bid_id 去重，重投应核对原内容。

不重复存 item_id，不添加是否中拍字段，不将 RECEIVED／CONFIRMED 个人回执状态作为本表字段。是否正式胜出由场次结果表达。

accepted_at 与 created_at 不同，消费延迟不会改变报价的原裁决时间；具体时间类型与精度待物理设计。
