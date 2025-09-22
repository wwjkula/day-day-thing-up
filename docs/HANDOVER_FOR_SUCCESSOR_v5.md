# 日事日清 / 周度汇总（Serverless 版）继任者交接文档 v5

> 目的：帮助继任者在最短时间内掌握当前完成度、技术栈与关键实现，依据任务清单无缝推进下一步。

---

## 1) 当前完成状态（已验证）
- Monorepo：pnpm workspaces（apps/web、apps/worker、packages/shared）
- 后端：Cloudflare Workers（Hono + TypeScript）
- 数据库：Neon（Serverless PostgreSQL）+ Prisma（@prisma/adapter-neon，HTTP 驱动）
- 认证：HS256 无状态 JWT（Web Crypto），鉴权中间件注入 ctx.user
- 可见域：统一引擎 resolveVisibleUsers（self/direct/subtree），闭包驱动灰度 VISIBILITY_USE_CLOSURE
- API：
  - POST /api/work-items（强校验：标题≤20、YYYY-MM-DD、type 枚举、自动主组织、审计）
  - GET  /api/work-items（from/to + scope，域过滤、分页、审计）
  - GET  /api/reports/weekly（week 或 from/to + scope，按人×按日聚合，审计 action=report_weekly）
  - POST /api/reports/weekly/export → 生成 ZIP(XLSX) → R2 → status/download（支持零成本 inline 驱动）
- 导出与存储：R2 桶绑定 day-day-thing-up-15976（binding=R2_EXPORTS），下载 Content-Type=application/zip（兼容 XLSX=ZIP）
- 零成本队列：QUEUE_DRIVER=inline（请求内联执行导出任务），API 契约不变，可随时切回 Queues
- 前端（MVP）：
  - QuickFill（快速填报）
  - MyRecords（本周我的记录）
  - WeeklyReport（周报+一键导出，含轮询 status 自动下载）
  - 轻量导航 Tabs（快速填报 / 我的记录 / 周报）
- 本地验证：
  - 构建：pnpm -C apps/web build 成功（Node 22.11 提示 22.12+，可构建；建议 22.12+）
  - 后端 dev：pnpm -C apps/worker dev；已验证 /api/reports/weekly 与 export/status/download 闭环

---

## 2) 技术栈与架构决策（要点）
- Serverless：Workers（API）+ Pages（前端）+ Neon（Postgres）+ R2（导出）+ Queues（异步，可选）
- 路由：Hono；认证：无状态 JWT（HS256，Web Crypto）
- ORM：Prisma（Neon HTTP 适配）；Workers 环境跨请求复用客户端实例
- 权限：以“可见用户集合”为唯一口径，先算集合再查/聚合/导出；闭包驱动可灰度切换
- 导出：SheetJS 生成 XLSX；对象键保存至 R2；下载使用 application/zip；驱动以 QUEUE_DRIVER 抽象（inline|queues）
- 审计：create/list/report_weekly/export 统一写入 audit_logs（best-effort）
- Never break userspace：不破坏已验证的路由契约与下载行为

---

## 3) 与《设计文档.txt》的对照
已覆盖：
- 工作项最小单元与强校验；周度聚合 API；导出 ZIP(XLSX)；审计留痕
- 可见域统一求解（self/direct/subtree），闭包驱动灰度
- 前端 MVP（填报/我的/周报+导出）与轻量导航

尚待补齐（关键差异）：
- canExport 策略化（403 场景、速率限制）与统一配置
- 组织闭包表与关键索引（org_closure、work_items 索引）迁移及基准
- 缺报名单（weekly missing）API 与前端标注
- 定时任务（周日 20:00 自动入队）与过期导出清理
- CI/CD；prisma.config.ts 迁移；/dev/token 生产开关
- 导出产物优化（命名/水印/分包）与审计扩展

---

## 4) 下一步任务清单（摘要，详见任务管理器）
P1（主干闭环与治理）
1) canExport 策略化 + 速率限制 + 测试
2) 数据库迁移：org_closure + 核心索引
3) API：缺报名单（/api/reports/missing-weekly）
4) Infra：R2/Queues 生产绑定与驱动切换校验
5) 工程治理：CI + prisma.config.ts 迁移 + /dev/token 开关
6) 前端：周报页增强（细节展开与状态提示）

P2（体验与运营）
7) 导出优化：命名/水印/分包 + 审计扩展
8) 定时任务：Cron（周日 20:00 入队）与清理
9) 安全加固：JWT 时钟偏移与输入校验集中化
10) 性能调优与分页策略

P3（增强与生态）
11) 附件上传与展示（R2 独立 bucket）
12) 历史可见性快照模式（可配置）
13) Web：下属树与统计看板
14) 集成：AD/LDAP 与企业微信（可选）

---

## 5) 运行与环境
- Node：推荐 22.12+（Vite 7 对版本敏感；20.19+ 亦可）
- 后端：
  - 开发：pnpm -C apps/worker dev
  - 环境变量（wrangler.jsonc / secret）：DATABASE_URL、JWT_SECRET、VISIBILITY_USE_CLOSURE、QUEUE_DRIVER、R2/Queues 绑定
- 前端：
  - 开发：pnpm -C apps/web dev
  - 构建：pnpm -C apps/web build
- 零成本导出与队列驱动：
  - 本地/零成本：QUEUE_DRIVER=inline（导出任务在请求内联执行）
  - 切回真实队列：QUEUE_DRIVER=queues（确保 EXPORT_QUEUE/R2 绑定有效）
  - API 契约不变：export → status?id → download?id

---

## 6) 关键代码索引
- apps/worker/src/index.ts：所有现有路由 + 导出处理（含 inline 驱动）
- apps/worker/src/middlewares/permissions.ts：权限/审计中间件（scope/range 解析、审计）
- apps/worker/src/visibility.ts：可见域求解与闭包驱动接口
- apps/worker/prisma/schema.prisma：数据模型
- packages/shared/src/index.ts：DTO 与校验函数
- apps/web/src/components/WeeklyReport.vue：周报+导出 页面
- apps/web/src/api.ts：前端 API 客户端封装

---

## 7) 注意事项
- Never break userspace：新增/修改应保持既有 API 契约不变
- 统一口径：周一为周首、标题≤20 字后端为准，前后端一致
- 安全：/dev/token 仅限本地；线上 secrets 注入；导出建议加入水印与速率限制
- 运维：绑定与驱动切换需有清晰文档与脚本

---

有问题请从 apps/worker/src/index.ts 的 weekly/export 路径与 middlewares/permissions.ts 入手，配合 docs/HANDOVER_*.md 与 设计文档.txt 对照理解；本地按“获取 /dev/token → 调 weekly → 导出/status/download”验证闭环即可。

