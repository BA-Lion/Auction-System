# auction_items — 拍品表

整理日期：2026-11-17。依据 [confirm-design v1.1](../confirm-design/README.md)；共同约定与待定边界见 [目录说明](./README.md)。

## 字段

| 字段 | 含义及已确定约束 |
| --- | --- |
| id | 拍品主键 |
| seller_id | 卖家用户 ID |
| title | 拍品标题 |
| description | 拍品描述 |
| images | 图片信息，具体存储格式待定 |
| category_code | 分类编码 |
| status | 待拍卖／待成交／已出售 |
| current_round_id | 当前关联场次 ID |
| created_at | 创建时间 |
| updated_at | 修改时间 |

## 约束与业务使用

主键 id。卖家关联 users，当前场次关联 auction_rounds；这些是逻辑关系，尚未决定是否创建物理外键。

开拍时设待成交，竞价中和等待付款均保持待成交；成交后已出售；流拍处理后恢复待拍卖。重拍建立新场次，更新当前场次关联。资金任务必须核对 current_round_id，避免旧场任务影响新场。

标题长度、图片结构、分类约束及列表索引仍待物理设计。
