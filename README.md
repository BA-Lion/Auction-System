# Auction System · 多场次竞拍系统

Auction System 面向多个拍卖场次同时开拍的场景。竞拍者按场报名、冻结押金，输入金额出价，通过榜单和实时通知判断是否领先。系统按场次分散负载，同一场次的并发报价、尾盘加时和关场则需要有明确的裁决顺序。

仓库包含可运行的本地竞拍 Demo，以及 v1.1 设计基线和九张核心表的逻辑模型。

## 运行本地演示

使用 Node.js 22 或更新版本，在仓库根目录执行：

```sh
npm ci
npm start
```

打开 [拍物竞拍大厅](http://127.0.0.1:4173)。初次启动会创建三件配有演示图的拍品。服务仅监听本机，可通过 `PORT` 指定其他端口。账号、拍品、订单和钱包保存在本地 `.cache/auction-demo.json`，重启服务后重新登录即可继续。请以单个服务进程使用同一份数据。

1. 在一个浏览器配置中注册卖家，进入“卖家中心”，保存拍品后创建立即或预约场次。演示可设起拍价 100 元、时长 120 秒。
2. 用另一浏览器或独立浏览器配置注册竞拍者。到“我的钱包”模拟充值 500 元，在大厅进入场次并报名。可用余额变为 400 元，冻结金额为 100 元。
3. 提交 130 元报价，在卖家窗口观察榜单。第二位竞拍者可以从第三个独立配置加入。最后 10 秒内的有效报价延长截止 30 秒，最多五次。大厅和场次页都可主动刷新。
4. 关场后赢家支付 30 元尾款，卖家获得 117 元，另一竞拍者的押金解冻。赢家刷新“我的钱包”可核对付款流水。零尾款自动结算，正尾款有两小时付款窗口。

`npm test` 使用隔离数据和可控时钟验证 HTTP 与 WebSocket 流程。Demo 用单个 Node.js 服务模拟排队确认、场次调度、查询快照及资金事务。下文描述正式系统设计。

## 构建正式 Java 后端

在 JDK 25 环境下进入 `backend`，使用项目自带的 Maven Wrapper 构建。Windows PowerShell 命令如下。

```powershell
cd backend
.\mvnw.cmd clean verify
java -jar target/auction-backend-0.1.0-SNAPSHOT.jar --spring.profiles.active=skeleton
```

macOS 或 Linux 可用 `sh mvnw clean verify`。首次构建需要访问 Maven Central。应用默认监听 8080，`skeleton` 配置用于本地验证框架启动。Spring Security 的默认策略保护 HTTP 入口；业务 API 仍由上方的 Node.js Demo 提供。连接正式 MySQL 时使用默认配置，通过 `SPRING_DATASOURCE_URL`、`SPRING_DATASOURCE_USERNAME` 和 `SPRING_DATASOURCE_PASSWORD` 提供连接信息。

Java 源码位于 [com.auction](backend/src/main/java/com/auction/)。HTTP 入口集中在 `trigger/http`，Kafka 入口在同级的 `consumer` 包。报名模块展示 Service、Repository 接口和基础设施实现的目录结构。框架与驱动版本见 [Maven 工程](backend/pom.xml)。

## 一场竞拍如何进行

1. **报名**。系统按起拍价冻结竞拍者钱包中的可用余额，报名记录保存本场实际冻结的金额。一个用户可同时参与多场。
2. **出价**。NGINX 将请求分发到业务实例。同一场次的资格、价格、截止时间和待发报价事件位于 Redis Cluster 的同一哈希槽。一段 Lua 脚本完成校验、更新榜单并写入待发事件，随后向出价者返回“报价已通过”。
3. **反馈**。报价异步进入 Kafka。落库组在 MySQL 报价明细事务提交后将个人回执更新为“报价已记录”。WebSocket 推送场次变化和个人报价状态。
4. **加时与关场**。最后 10 秒内的有效报价将当时的截止时间延长 30 秒，每场最多加时 5 次。首笔等于起拍价也适用。关场时重新核对本场最新截止时间。
5. **结算**。有中拍者时，正式结果驱动同场唯一订单。未中拍者解冻押金，中拍者正常成交时以冻结押金抵扣成交价并支付尾款。钱包、押金状态和流水按数据库事务处理。

列表检索使用 Elasticsearch 从数据库已提交的数据构建索引，允许短暂延迟。出价以 Redis 中的本场运行状态为准，订单和资金以数据库事务结果为准。

## 设计文档

[前端 Demo HTTP 与 WebSocket 契约（评审稿）](docs/api/frontend-demo.md)覆盖共享模拟服务和前端使用的业务接口。

| 想了解什么 | 阅读入口 |
| --- | --- |
| 系统范围、组件职责和业务规则 | [设计基线 v1.1](docs/confirm-design/README.md) |
| 报名、订单、钱包和流水如何关联 | [九张核心表](docs/tables/README.md) |
| 并发和故障场景如何验收 | [运维核对与验收依据](docs/confirm-design/08-运维核对与验收依据.md) |
| 哪些规则和参数仍待决定 | [待定项与来源追溯](docs/confirm-design/09-待定项与来源追溯.md) |

## 本地配置

本地环境变量保存在 Git 忽略的 `.env` 或 `.env.local` 中。共享配置使用不含密钥的 `.env.example`。选定包管理器后，将依赖锁文件纳入版本控制。
