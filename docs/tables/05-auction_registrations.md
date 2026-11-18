# auction_registrations — 报名与押金表

整理日期：2026-11-17。依据 [confirm-design v1.1](../confirm-design/README.md)；共同约定与待定边界见 [目录说明](./README.md)。

## 字段

| 字段 | 含义及已确定约束 |
| --- | --- |
| id | 报名记录主键 |
| round_id | 报名场次 ID |
| user_id | 报名用户 ID |
| deposit_amount | 该报名实际冻结的押金，整数分，固定留存 |
| deposit_status | FROZEN／RELEASED／APPLIED／FORFEITED |
| created_at | 创建时间 |
| updated_at | 修改时间 |

## 约束与业务使用

约束：主键 id；UNIQUE(round_id, user_id)。当前押金等于本场起拍价，后续配置变化不得改写已冻结金额。

| 状态 | 含义 | 进入时机 |
| --- | --- | --- |
| FROZEN | 押金占用中 | 报名冻结成功 |
| RELEASED | 押金解冻回可用余额 | 未中拍解冻成功 |
| APPLIED | 冻结押金已用于成交 | 正常付款或零尾款成交 |
| FORFEITED | 冻结押金已用于违约补偿 | 正尾款超时结算 |

只允许 FROZEN 转向三个互斥终态之一。报名记录、冻结流水和钱包转换同事务提交；重复报名不重复冻结。解冻、抵扣、违约扣除也必须同时提交本记录状态、钱包、流水和对应任务结果。

一次结算只能消耗本报名押金，不能使用该用户其他场次冻结金额。
