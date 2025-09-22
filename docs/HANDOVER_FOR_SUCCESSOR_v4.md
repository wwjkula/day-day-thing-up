# 日事日清 / 周度汇总（Serverless 版）继任者交接文档 v4

> 目的：让继任者在最短时间内掌握现状、技术栈与关键实现，并基于对齐的任务清单无缝推进。

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
  - POST /api/reports/weekly/export → 生成 ZIP(XLSX) → R2 → status/download（已支持零成本 inline 驱动）
- 导出与存储：R2 桶绑定 day-day-thing-up-15976（binding=R2_EXPORTS），支持 application/zip 下载（兼容 XLSX=ZIP 的事实）
- 零成本队列：QUEUE_DRIVER=inline（请求内联执行导出任务），保持 API 契约不变，可随时切回 Queues
- 测试与验证：本地 dev + e2e 脚本验证导出/status/download 全链路通过

快速验证（本地）：
1) pnpm -C apps/worker dev
2) GET /dev/token?sub=1 取得 token
3) POST /api/reports/weekly/export?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=self（Bearer <token>）
4) GET  /api/reports/weekly/export/status?id=<jobId>
5) GET  /api/reports/weekly/export/download?id=<jobId>（Content-Type: application/zip）

---

## 2. 技术栈与架构决策
- Serverless：Workers（API）+ Pages（前端）+ Neon（Postgres）+ R2（导出产物）+ Queues（异步，可选）
- 路由：Hono；认证：无状态 JWT（HS256，Web Crypto）
- ORM：Prisma（Neon HTTP 适配）；Workers 环境跨请求复用客户端实例
- 权限：以“可见用户集合”为唯一口径，先算集合再查/聚合/导出；闭包驱动可灰度切换
- 导出：SheetJS 生成 XLSX；对象键保存至 R2；下载使用 application/zip
- 审计：create/list/report_weekly/export 等动作统一写入 audit_logs（best-effort）
- 驱动去条件化：导出队列以 QUEUE_DRIVER 抽象（inline|queues），Never break userspace

---

## 3. 与《设计文档.txt》的对照
已覆盖：
- 工作项最小单元与强校验；周度聚合 API；导出 ZIP(XLSX)；审计留痕
- 可见域统一求解（self/direct/subtree），闭包驱动灰度
- 零成本导出驱动（inline），不改变 API 契约

尚待补齐（关键差异）：
- canExport 策略化（403 场景、速率限制）与统一配置
- 组织闭包表与关键索引（org_closure、work_items 索引）迁移及基准
- 缺报名单（weekly missing）API 与前端标注
- 前端周报页与导出对接；领导“我的下属”树视图、统计看板
- 定时任务（周日 20:00 自动入队）与过期导出清理；CI/CD；prisma.config.ts 迁移；/dev/token 生产开关

---

## 4. 下一步任务（摘要）
P1（主干闭环与治理）
1) 前端：周报页与导出接入（Vue3 + Element Plus）
   - 目标：渲染 GET /api/reports/weekly 数据（周一为周首），提供导出按钮→轮询 status→下载 ZIP
   - 技术：Vue3/TS、Element Plus、统一 DTO、Asia/Shanghai 周口径
   - 交付：页面组件与路由、API 客户端封装、最小 e2e（可选 MSW/Playwright）
2) 权限：canExport 策略化 + 审计统一 + 速率限制
   - 目标：集中配置导出可/不可（角色/域/范围），返回 403；为导出加最小速率限制
   - 技术：Hono 中间件；简易速率限制（dev 环境可内存、生产后续 DO/Workers KV）
   - 交付：中间件、配置示例、Vitest
3) DB：组织闭包与索引
   - 目标：迁移创建 org_closure 与核心索引；seed 刷新；Explain 基准
   - 技术：原生 SQL 迁移、Prisma migrate、性能基准
   - 交付：migrations、seed、Explain 报告
4) API：缺报名单（/api/reports/missing-weekly）
   - 目标：输出“按日/整周缺报用户”，用于前端标注与导出
   - 技术：CTE/闭包 + 日期维度；权限集合过滤
   - 交付：路由实现、测试、示例响应
5) 工程治理：CI + prisma.config.ts + /dev/token 开关
   - 目标：CI 流水线（test/build/lint）、迁移到 prisma.config.ts、为 /dev/token 增加 env 开关（仅本地）
   - 技术：GitHub Actions、pnpm 缓存、wrangler secret
   - 交付：ci.yml、prisma.config.ts、文档

P2（体验与运营）
6) 导出优化：命名/水印/分包
7) 定时与清理：Cron Triggers（周日 20:00 入队、过期清理）
8) 安全加固：JWT 时钟偏移、输入校验集中化
9) Web：下属树与统计看板
10) 可选：Durable Object 驱动（QUEUE_DRIVER=durable）

---

## 5. 注意事项
- Never break userspace：任何修改保持现有 API 契约与下载行为不变
- 统一口径：周一为周首、标题≤20 字等在前后端一致，后端为准
- 安全：/dev/token 仅限本地；线上 secrets 注入；导出可加入水印与速率限制

---

## 6. 快速入口与文件索引
- apps/worker/src/index.ts：所有现有路由 + 导出处理（含 inline 驱动）
- apps/worker/src/middlewares/permissions.ts：权限/审计中间件（如有）
- apps/worker/src/visibility.ts：可见域求解与闭包驱动接口
- apps/worker/prisma/schema.prisma：数据模型
- docs/README.md：零成本导出与队列驱动说明
- docs/HANDOVER_*.md：交接与补充文档

