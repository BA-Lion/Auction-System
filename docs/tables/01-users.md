# users — 用户表

整理日期：2026-11-17。依据 [confirm-design v1.1](../confirm-design/README.md)；共同约定与待定边界见 [目录说明](./README.md)。

## 字段

| 字段 | 含义及已确定约束 |
| --- | --- |
| id | 用户主键 |
| username | 用户名，唯一且非空 |
| password_hash | 密码哈希 |
| nickname | 昵称 |
| created_at | 创建时间 |
| updated_at | 修改时间 |

## 约束与业务使用

同一用户可同时作为竞拍者、买家和卖家，不单独建立买卖角色表。

约束：主键 id；唯一 username。密码哈希算法、字段长度、其他字段可空规则留待物理设计。
