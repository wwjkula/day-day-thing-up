# 日事日清 / 周度汇总（Serverless 版）交接补充文档

## 1) 当前完成状态与运行验证
- 完成度（MVP 基座就绪）：
  - Monorepo：pnpm workspaces（apps/web、apps/worker、packages/...）
  - 后端：Cloudflare Workers + Hono + TypeScript（apps/worker）
  - 数据库：Neon（Serverless PostgreSQL）连通；Prisma Schema 已建，初始迁移与种子脚本可用
  - 认证：HS256 JWT（Web Crypto）；开发用 `/dev/token` 便捷路由
  - 可见域：统一引擎 `resolveVisibleUsers(self|direct|subtree, asOf)`（递归版 + 闭包表驱动）
  - 组织闭包表：`org_closure` 已迁移并全量构建；灰度开关 `VISIBILITY_USE_CLOSURE`
  - 健康检查：`/health` 基于 Neon HTTP 探活
- 本地验证（已实测）：
  - `pnpm -C apps/worker dev` 启动成功（127.0.0.1:8787）
  - `prisma db seed` 种子通过（Alice 管理 Bob、Carol）
  - `GET /dev/token?sub=1` → 携带 Token 调用 `/subordinates` 返回 Bob、Carol（闭包驱动已开启）

## 2) 技术栈与架构决策
- 前端：Cloudflare Pages + Vue3/TS + Vite + Element Plus（apps/web）
- 后端：Cloudflare Workers（Hono 路由，TypeScript）
- 数据库：Neon（PostgreSQL），Prisma ORM + @prisma/adapter-neon（HTTP）
- 存储：Cloudflare R2（导出产物）
- 队列：Cloudflare Queues（导出异步任务）
- 认证：无状态 JWT（HS256），ctx.user 注入
- 可见域：管理边 + 授权域 + 组织闭包表；动态策略（按查询时点）
- 驱动切换：`resolveVisibleUsers` 支持递归 CTE 与 `org_closure` 驱动，以 env 灰度

## 3) 关键实现细节（选摘）
- `apps/worker/src/visibility.ts`：
  - 统一求解 visible users 的“集合引擎”，支持 self/direct/subtree
  - 注入式 drivers：递归查询 or `makeClosureDrivers(prisma)`（org_closure）
- `apps/worker/src/index.ts`：
  - `/subordinates` 路由统一调用 `resolveVisibleUsers('direct')`
  - 环境变量：`VISIBILITY_USE_CLOSURE=true|false` 切换闭包驱动
- `apps/worker/prisma/migrations/20250921_000001_add_org_closure/migration.sql`：
  - 创建 `org_closure(ancestor_id, descendant_id, depth)` 与索引
  - 使用递归 CTE 全量构建闭包

## 4) 与《设计文档.txt》的对照
- 已实现：
  - 数据模型骨架（组织/人员/管理边/角色/授权/工作项/附件/审计）
  - 统一可见域算法（管理边 + 授权域 + 组织树），与闭包表灰度
  - 健康/鉴权/开发便捷 token
- 未实现（关键待办）：
  - 工作项 API（增查）与标题≤20字强校验（后端）
  - 周度聚合 API（周一定义、一致口径）
  - 导出流水线（Queues+R2，xlsx+zip）、导出审计与水印
  - canRead/canExport 权限拦截与审计日志
  - 前端 MVP 页面（快速填报、我的、下属、导出）
  - 性能与索引优化、CI、prisma.config.ts 迁移、/dev/token 生产开关

## 5) 环境与运行说明
- 本地 env（apps/worker/wrangler.jsonc → vars）
  - `DATABASE_URL`：Neon 连接串（sslmode=require, channel_binding=require）
  - `JWT_SECRET`：开发密钥
  - `VISIBILITY_USE_CLOSURE`：是否启用闭包驱动（默认 true 可灰度）
  - `QUEUE_DRIVER`: `inline|queues`（默认建议 inline 
- 常用命令
  - 启动：`pnpm -C apps/worker dev`
  - 种子：`pnpm -C apps/worker exec -- prisma db seed`
  - 迁移：`pnpm -C apps/worker exec -- prisma migrate deploy`
  - 测试：`pnpm -C apps/worker test`

## 6) 下一步建议与注意事项
- 优先级 P1（建议顺序）
  1) 工作项 API（POST/GET）+ 强校验 + 域过滤
  2) 周度聚合 API（JSON）
  3) 导出流水线（Queues + R2）
  4) 审计与权限拦截（canRead/canExport）
  5) 权限矩阵扩展测试 + 性能/索引优化
  6) 前端 MVP 页面对接
- 注意事项
  - Never break userspace：保留现有路由契约与调试流程
  - 统一口径：周一定义、20字限制在前后端一致，服务端为准
  - 安全：任何读/导出都必须走服务器端域过滤和审计
  - 秘钥：线上用 `wrangler secret` 注入，不提交版本库

## 7) 联系点与风格
- 决策准则：实用主义、去条件化（以闭包/物化简化查询）、统一权限入口
- 代码风格：短小函数、单一职责、集合思维（把条件转为集合并集/交集）

> 这份交接文档与 docs/HANDOVER.md 配合使用：前者侧重“现状与下一步”，后者包含更完整的背景和索引。


## 附：零成本导出与队列驱动
- 本地/零成本：在 wrangler.jsonc 的 vars 设置 QUEUE_DRIVER=inline，导出任务在请求内联执行，不依赖 Cloudflare Queues。
- 切回真实队列：将 QUEUE_DRIVER=queues，且确保 EXPORT_QUEUE 绑定有效（producers/consumers 指向相同队列）。
- API 契约保持不变：
  - POST /api/reports/weekly/export?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=...
  - GET  /api/reports/weekly/export/status?id=<jobId>
  - GET  /api/reports/weekly/export/download?id=<jobId>
