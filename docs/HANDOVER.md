# 日事日清 / 周度汇总（Serverless 版）交接说明

本说明面向接手该项目的工程师，概述当前完成度、如何本地运行、架构与关键决策、下一步工作与注意事项。

---

## 1) 当前完成度与可运行状态

已完成（MVP 基座）：
- Monorepo：pnpm workspaces（apps/web、apps/worker、packages/shared）
- 前端骨架：Vite + Vue3 + TS + Element Plus（apps/web，已能构建）
- 后端骨架：Cloudflare Workers + Hono + TypeScript（apps/worker）
- 数据层：Prisma Schema（对齐设计文档 §3.1），已生成并应用初始迁移
- 数据库：接入 Neon（Serverless PostgreSQL），HTTP 驱动，连通性通过
- 种子数据：组织/用户/管理边/角色/授权/示例工作项（可重复跑）
- 认证：HS256 无状态 JWT（纯 Web Crypto），鉴权中间件注入 ctx.user
- 基础可见域：直接下属（/subordinates）按有效期过滤
- 健康检查：/health 通过（Neon HTTP 直接探活）

本地验证：
- 启动：`pnpm -C apps/worker dev`
- 健康：`curl 127.0.0.1:<port>/health` -> `{ ok: true }`
- 获取 Token（开发便捷）：`GET /dev/token?sub=1&name=Alice&email=alice@example.com`
- 鉴权 & 用户：`curl -H "Authorization: Bearer <token>" /me`
- 可见域（direct）：`curl -H "Authorization: Bearer <token>" /subordinates`

---

## 2) 技术栈与架构决策

- 前端：Cloudflare Pages（部署）+ Vue3/TS/Vite/Element Plus
- 后端：Cloudflare Workers（Hono 路由），无状态鉴权（JWT）
- 数据库：Neon（Serverless PostgreSQL），Prisma ORM + @prisma/adapter-neon（HTTP）
- 对象存储：Cloudflare R2（用于导出压缩包）
- 异步任务：Cloudflare Queues（导出流水线）
- Monorepo：pnpm workspaces；共享 types/DTO 放在 packages/shared
- 决策要点：
  - Workers 环境使用 Neon HTTP 驱动（fetch）做 /health 探活，稳定性第一
  - Prisma 驱动适配在 Worker 中复用单实例，避免冷启动抖动
  - 种子脚本带 TRUNCATE RESTART IDENTITY，保证幂等

---

## 3) 代码与配置索引

- apps/worker/src/index.ts：Hono 应用、鉴权中间件、/health /me /subordinates /dev/token
- apps/worker/src/auth.ts：HS256 JWT 签发/校验（无依赖）
- apps/worker/prisma/schema.prisma：数据模型（§3.1）
- apps/worker/prisma/seed.mjs：种子脚本（可重复执行）
- apps/worker/wrangler.jsonc：本地开发 vars（DATABASE_URL、JWT_SECRET）

环境变量（本地 wrangler.jsonc / 线上用 wrangler secret）：
- DATABASE_URL：Neon 连接串（require ssl / channel_binding=require）
- JWT_SECRET：HS256 开发密钥（生产请置于 secret）

---

## 4) 与设计文档差异与待办

- 已覆盖：
  - 数据模型（组织/人员/管理边/角色/授权/工作项/附件/审计）
  - 动态策略的直接下属可见域
  - 认证与用户上下文注入
- 待完成（详见任务清单）：
  - resolveVisibleUsers(self|direct|subtree) 与闭包表/递归 CTE
  - role_grants 与域融合（代理/临时负责人时间窗）
  - 工作项 API（增查）与标题≤20字强校验
  - 周度聚合与导出流水线（Queues + R2，xlsx+zip）
  - 审计日志与 canRead/canExport 拦截
  - 前端 MVP 页面
  - 索引与性能优化、单测/矩阵用例、CI
  - prisma.config.ts（移除 package.json#prisma 警告）

---

## 5) 运行与开发

- Node：建议 20.19+ 或 22.12+（Workers/工具兼容）
- 启动 Worker：`pnpm -C apps/worker dev`
- 运行种子：
  - PowerShell：`$env:DATABASE_URL=...; pnpm -C apps/worker exec -- prisma db seed`
- 前端开发：`pnpm -C apps/web dev`

---

## 6) 下一步建议（高优先级）

1) P1：resolveVisibleUsers 与闭包表（org_closure）
2) P1：role_grants 融合（域 + 时间窗）与权限矩阵单测
3) P1：工作项 API（POST/GET）+ 后端强校验 + 最小前端对接
4) P1：导出流水线（Queues+R2）与审计

---

## 7) 注意事项

- 安全：任何查询都需服务端域过滤，不信任前端
- 稳定：/health 与鉴权保持简单、可观测；导出需全链路审计
- 兼容：标题≤20字、周定义（周一为首）等口径需端到端一致
- 秘密：线上使用 `wrangler secret` 注入 DATABASE_URL/JWT_SECRET；勿提交到版本库

---

## 8) 已知问题与优化

- Prisma CLI 警告：package.json#prisma 将在 v7 废弃 → 迁移至 prisma.config.ts
- /dev/token 仅用于本地验证，上线前应移除或 behind flag


## 9) 导出与队列配置（零成本模式）
- R2：已在本地绑定 bucket `day-day-thing-up-15976`（binding=R2_EXPORTS）
- 队列驱动：支持 `QUEUE_DRIVER=inline|queues`
  - 本地/零成本：`QUEUE_DRIVER=inline`（导出在请求内联执行，不依赖 Cloudflare Queues）
  - 切回真实队列：将 `QUEUE_DRIVER=queues` 且确保 `EXPORT_QUEUE` 绑定有效
- API 契约不变：
  - 请求：`POST /api/reports/weekly/export?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=...`
  - 轮询：`GET  /api/reports/weekly/export/status?id=<jobId>`
  - 下载：`GET  /api/reports/weekly/export/download?id=<jobId>`

如需更多细节，请查看 `设计文档.txt` 与 `apps/worker/src/index.ts` 的路由实现。

