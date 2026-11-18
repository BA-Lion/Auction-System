# auction_orders — 中拍订单表

整理日期：2026-11-17。依据 [confirm-design v1.1](../confirm-design/README.md)；共同约定与待定边界见 [目录说明](./README.md)。

## 字段

| 字段 | 含义及已确定约束 |
| --- | --- |
| id | 订单主键 |
| round_id | 所属场次 ID，同场唯一订单 |
| buyer_id | 中拍买家用户 ID |
| seller_id | 卖家用户 ID |
| deal_amount | 完整成交价 P，整数分 |
| deposit_amount | 本单使用的冻结押金 D |
| remaining_amount | 待付尾款 R = P − D |
| status | 待支付／已支付／超时关闭 |
| expires_at | 付款到期时间，按竞拍结束后两小时确定 |
| paid_at | 正常成交处理时间；未支付时为空 |
| closed_at | 超时关闭处理时间；正常成交时为空 |
| settlement_type | 正常成交／流拍补偿 |
| settlement_base_amount | 分账基数，正常为 P，超时为 D |
| platform_rate_bps | 平台费率，1000 为 10%，5000 为 50% |
| platform_amount | 平台收入金额 |
| seller_amount | 卖家实际入账金额 |
| settled_at | 分账完成处理时间 |
| created_at | 创建时间 |
| updated_at | 修改时间 |

## 约束与业务使用

约束：主键 id；UNIQUE(round_id)。通过场次关联拍品和胜出报价。已讨论索引方向：(buyer_id, created_at, id)、(status, expires_at)。

建单固定买卖双方、P、D、R 和 expires_at，不因消息消费迟到延长付款窗口。尚未结算时，相应分账结果字段为空。

正常成交基数 P，平台 10%；正尾款超时基数 D，平台 50%。平台金额 = 基数 × 费率整除 10000，卖家取得剩余部分；向下取整到分，尾数归卖家。

| 分支 | 押金状态 | 时间字段 |
| --- | --- | --- |
| 正常付款、零尾款成交 | APPLIED | paid_at = settled_at，closed_at 为空 |
| 正尾款超时补偿 | FORFEITED | closed_at = settled_at，paid_at 为空 |

零尾款仍消耗冻结押金，并记录完整成交价购买付款流水。正常成交与超时互斥，竞争同一订单处理权。卖家入账、买家扣款、报名状态、流水、订单及拍品更新同事务；任务触发时同事务更新 Outbox SUCCESS。
