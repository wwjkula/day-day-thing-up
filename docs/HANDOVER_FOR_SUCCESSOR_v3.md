# 日事日清 / 周度汇总（Serverless 版）继任者交接文档 v3

> 目标：继任者在最短时间内掌握当前进度、技术栈与关键实现，并基于对齐的任务清单无缝推进。

---

## 1. 当前完成状态（已验证）
- Monorepo：pnpm workspaces（apps/web、apps/worker、packages/shared）
- 后端：Cloudflare Workers（Hono + TypeScript）
- 数据库：Neon（Serverless PostgreSQL）+ Prisma（@prisma/adapter-neon，HTTP 驱动）
- 认证：HS256 无状态 JWT（Web Crypto），鉴权中间件注入 ctx.user
- 可见域：统一引擎 resolveVisibleUsers（self/direct/subtree），闭包驱动灰度 VISIBILITY_USE_CLOSURE
- API：
  - POST /api/work-items（强校验：标题≤20、YYYY-MM-DD、type 枚举、自动主组织、审计）
  - GET  /api/work-items（from/to + scope，域过滤、分页、审计）
  - GET  /api/reports/weekly（week 或 from/to + scope，按人×按日聚合，审计 action=report_weekly）
  - POST /api/reports/weekly/export → 队列 → R2 → status/download（产物 ZIP 封装 XLSX）
- 中间件与审计（本次新增/统一）：
  - middlewares/permissions.ts：canRead/canExport + audit()，统一 scope 正常化与日期口径解析，统一审计写入
  - /api/work-items、/api/reports/weekly、/api/reports/weekly/export 已接入
- 测试：Vitest 全绿（5 文件 / 16 用例）

本地验证：
- 启动：`pnpm -C apps/worker dev`
- 测试：`pnpm -C apps/worker test`（当前全绿）
- 获取 token（仅本地）：`GET /dev/token?sub=1`
- 环境变量（wrangler.jsonc / secret）：DATABASE_URL、JWT_SECRET、VISIBILITY_USE_CLOSURE、R2/Queues 绑定

---

## 2. 技术栈与架构决策（要点）
- Serverless：Workers（API）+ Pages（前端）+ Neon（Postgres）+ R2（导出产物）+ Queues（异步）
- 路由：Hono；认证：无状态 JWT（HS256，Web Crypto）
- ORM：Prisma（Neon HTTP 适配）；Workers 环境跨请求复用客户端实例
- 权限：以“可见用户集合”为唯一口径，先算集合再查/聚合/导出；闭包驱动可灰度
- 导出：队列消费者生成 XLSX（SheetJS），对象键保存至 R2；下载使用 application/zip（兼容 XLSX=ZIP 事实）
- 审计：create/list/report_weekly/export 等关键动作统一写入 audit_logs（best-effort）

---

## 3. 与《设计文档.txt》的对照
已覆盖：
- 工作项最小单元与强校验；周度聚合 API；异步导出 ZIP(XLSX)；审计留痕
- 可见域统一求解（self/direct/subtree），闭包驱动灰度
- 中间件化的范围解析与审计统一（本次收口）

尚待补齐（关键差异）：
- canExport 权限策略化（403 场景、角色/域策略集中配置）
- 组织闭包表与关键索引（org_closure、work_items 索引）
- 缺报名单（weekly missing）API 与前端标注
- 前端周报页与导出对接；领导“我的下属”树视图、统计看板
- 定时任务（周日 20:00 自动入队）与过期导出清理；CI/CD；生产安全收口

---

## 4. 权限与审计中间件（口径）
- scope 正常化：`subordinates` 视为 `direct`；默认为 `self`
- 日期口径：支持 `week=YYYYWww`（周一为首）或 `from/to=YYYY-MM-DD`；解析统一在中间件中完成
- 注入：`ctx.set('scope')`、`ctx.set('range'={start,end})`，路由仅消费注入结果
- 审计统一：`audit(prisma, { actorUserId, action, objectType?, objectId?, detail })`
  - 示例 detail：`{ scope, start, end, rows|count|jobId|objectKey }`

---

## 5. 下一步建议与注意事项
- 去条件化：继续将权限策略（导出可/不可）前置到 canExport，路由纯粹化
- 统一口径：周一为周首、标题≤20 字等在前后端一致，后端为准
- Never break userspace：任何修改保持现有 API 契约与下载行为不变
- 安全：/dev/token 仅限本地；线上 secrets 注入；对导出加入速率限制与水印策略（后续）

---

## 6. 任务清单（摘要）
> 详见任务管理工具中的条目；每项含目标/技术/交付物/优先级与顺序。

P1（主干闭环与治理）
1) 前端：周报页与导出接入（Vue3 + Element Plus）
2) Infra：wrangler 绑定 R2/Queues 并给出本地 dev 样例
3) DB：org_closure + 核心索引迁移，seed 刷新与 Explain 基准
4) API：缺报名单（/api/reports/missing-weekly）
5) 权限：canExport 策略化（403 场景）与单测
6) CI：Vitest + Build + Lint 流水线

P2（体验与运营）
7) 导出优化：命名/水印/分包
8) 定时与清理（Cron Triggers）
9) 安全加固：速率限制、/dev/token 开关、prisma.config.ts 迁移
10) Web：下属树与统计看板

P3（增强与生态）
11) 附件上传展示（R2 独立 bucket）
12) 历史可见性快照模式（可配置）
13) AD/LDAP & 企业微信集成

---

## 7. 快速入口与文件索引
- apps/worker/src/index.ts：所有现有路由 + 导出队列消费者
- apps/worker/src/middlewares/permissions.ts：canRead/canExport + audit（统一口径）
- apps/worker/src/visibility.ts：可见域求解与闭包驱动接口
- apps/worker/prisma/schema.prisma：数据模型
- packages/shared：DTO 与校验（如有）
- docs/设计文档.txt：业务与工程基线

---

## 8. 收尾
- 推荐推进节奏：
  1) canExport 策略化 → 2) 前端周报/导出 → 3) 闭包与索引 → 4) 缺报名单 → 5) CI/安全/运维化
- 任何问题从 apps/worker/src/index.ts 的 weekly 与 export 路径入手，配合中间件与可见域引擎理解全链路。


## 附：零成本导出与队列驱动
- 本地/零成本：设置 QUEUE_DRIVER=inline（wrangler.jsonc → vars），导出任务在请求内联执行，不依赖 Cloudflare Queues。
- 切回真实队列：设置 QUEUE_DRIVER=queues，并确保 EXPORT_QUEUE 绑定有效（producers/consumers 指向同一队列）。
- API 契约不变：POST /api/reports/weekly/export → status?id → download?id。
