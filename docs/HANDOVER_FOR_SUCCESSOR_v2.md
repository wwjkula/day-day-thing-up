# 日事日清 / 周度汇总（Serverless 版）继任者交接文档 v2

> 目标：让你在最短时间内明确当前完成度、技术决策与下一步规划，做到“即接即用、即刻推进”。

---

## 1. 当前完成度与运行状态（验证于本机）
- Monorepo：pnpm workspaces（apps/web、apps/worker、packages/shared）
- 后端：Cloudflare Workers（Hono + TypeScript）
- 数据库：Neon（Serverless PostgreSQL）+ Prisma（@prisma/adapter-neon，HTTP 驱动）
- 认证：HS256 无状态 JWT（Web Crypto），鉴权中间件注入 ctx.user
- 可见域：统一引擎 resolveVisibleUsers（支持 self/direct/subtree），闭包驱动灰度 VISIBILITY_USE_CLOSURE
- 已实现 API：
  - POST /api/work-items（标题≤20、YYYY-MM-DD、type 枚举、自动主组织、审计）
  - GET /api/work-items（from/to + scope，域过滤、分页、审计）
  - GET /api/reports/weekly（week 或 from/to + scope，按人×按日聚合，审计 action=report_weekly）
  - 导出流水线：POST /api/reports/weekly/export → 队列 → R2 → status/download（产物为 ZIP 封装的 XLSX，含 Summary/ByUser/Details 多 Sheet，审计 action=export）
- 本地验证：`pnpm -C apps/worker test` 全部通过（4 files / 13 tests，全绿）

运行要点：
- 启动：`pnpm -C apps/worker dev`
- 获取 token（仅本地）：`GET /dev/token?sub=1` → 带 Bearer 调用其它 API
- 环境变量（wrangler.jsonc / secret）：DATABASE_URL、JWT_SECRET、VISIBILITY_USE_CLOSURE

---

## 2. 技术栈与架构决策
- Serverless：Cloudflare Workers（API）+ Pages（前端）+ Neon（Postgres）+ R2（导出产物）+ Queues（异步）
- 路由：Hono；鉴权：无状态 JWT（HS256，Web Crypto）
- ORM：Prisma（Neon HTTP 适配）；客户端实例跨请求复用（Workers 环境）
- 可见域：以“可见用户集合”为唯一口径，先算集合再查数据；支持递归/闭包两种驱动（env 灰度）
- 导出：队列消费者生成 XLSX（SheetJS），对象键保存至 R2，下载路径稳定（保持 application/zip 以兼容 XLSX=ZIP 的事实）
- 审计：create/list/report_weekly/export 等关键动作均写入 audit_logs（best-effort）

---

## 3. 与《设计文档.txt》的对照
已覆盖（核心闭环已跑通）：
- 工作项最小单元与强校验；周度聚合 API（周一为周首，ISO 周支持）；异步导出 ZIP(XLSX)；审计留痕
- 可见域统一求解（self/direct/subtree），并具备闭包驱动灰度

尚待补齐（关键差异）：
- canExport 中间件化与审计统一（当前在具体路由写审计，需前置统一拦截）
- 组织闭包表与关键索引（org_closure、work_items(creator_id, work_date) 等）
- 缺报名单（weekly missing）API 及前端标注
- 前端周报页与导出对接；领导“我的下属”树视图、统计看板
- 定时任务（周日 20:00 自动入队）与过期导出清理；CI/CD；生产安全收口

---

## 4. 下一步任务（优先级与交付物）
P1（主干闭环与治理）
1) canExport 中间件化 + 审计统一
   - 技术：Hono 中间件；与 canRead 对齐；统一 detail 字段（scope、start/end、jobId、objectKey、rowCount）
   - 交付：中间件 + 接入 /api/reports/weekly/export*；Vitest 覆盖
2) 前端周报页与导出对接
   - 技术：Vue3 + Element Plus；调用 weekly API 渲染；导出按钮入队→轮询 status→下载
   - 交付：页面、API 封装、最小 e2e（MSW/Playwright 可选）
3) 组织闭包与索引
   - 技术：PG 迁移脚本；构建 org_closure；补充核心索引；Explain 基准
   - 交付：migrations、seed 刷新、基准报告
4) 缺报名单（API + 前端）
   - 技术：CTE/闭包 + 日期维度；输出“按日/整周缺报用户”
   - 交付：/api/reports/missing-weekly、前端标注/导出列

P2（体验与运营）
5) 导出产物优化（命名/水印/分包）
   - 技术：消费者按组织/人拆分；水印含导出人/范围/时间
   - 交付：R2 键命名 {dept}_{YYYYWW}.zip；审计字段扩展（format,name,size,watermark）
6) 定时与清理（Cron）
   - 技术：CF Cron Triggers；策略化保留与清理
   - 交付：定时器、保留策略配置与文档
7) CI/CD
   - 技术：GitHub Actions；pnpm 缓存；wrangler secrets
   - 交付：ci.yml、环境文档
8) 安全加固
   - 技术：速率限制、JWT 时钟偏移、输入校验集中化、/dev/token 开关
   - 交付：中间件、配置、测试

P3（增强与生态）
9) 附件上传与展示（R2 独立 bucket，SHA256 校验、鉴权）
10) 历史可见性快照模式（可配置）
11) 标签/看板统计（聚合 API + 前端图表）
12) AD/LDAP & 企业微信集成（单点/通知）
13) 数据留存与归档（3-5 年，归档只读）

---

## 5. 关键实现细节与设计取舍
- 口径统一：
  - 周定义：周一为首（Asia/Shanghai）；ISO 周字符串 YYYYWww 可选
  - 标题长度：以 Unicode 码点计数 ≤ 20，后端强校验
  - 权限：先算“可见集合”再聚合/查询，避免条件分支散落
- 可恢复性：
  - 队列消费者建册：即便 DB 不可用亦产出 Summary Sheet，保证消息可完成与可追踪；错峰重试不中断业务
- 兼容性：
  - XLSX 本质为 ZIP；下载仍用 application/zip，保持用户空间稳定（Never break userspace）
- 性能与稳定：
  - Prisma 客户端跨请求复用；Neon HTTP 在 /health 直连探活；索引与闭包表纳入下一步

---

## 6. 本地运行与排障速查
- 测试：`pnpm -C apps/worker test`（当前 4/4 文件，13/13 通过）
- 启动：`pnpm -C apps/worker dev`（获取 /dev/token 后测试各 API）
- 常见问题：
  - Node 版本：建议 22.12+；Vite/Workers 对 20.19+ 亦可
  - Secret：生产请使用 `wrangler secret` 注入；勿提交敏感信息

---

## 7. 接口与文件索引（主干）
- apps/worker/src/index.ts：所有现有路由 + 导出队列消费者
- apps/worker/src/visibility.ts：可见域求解器与闭包驱动注入
- apps/worker/src/auth.ts：HS256 JWT 签发/验证
- apps/worker/prisma/schema.prisma：数据模型
- docs/设计文档.txt：业务与工程基线

---

## 8. 建议推进节奏
1) P1 全收口：canExport → 前端周报/导出 → 闭包与索引 → 缺报名单
2) P2 运营化：命名/水印/分包 → Cron → CI/CD → 安全加固
3) P3 增强项按需拉动

> 如需进一步指引，建议从 apps/worker/src/index.ts 的 weekly 与 export 路径切入（最短链路理解全栈闭环）。



## 附：零成本导出与队列驱动
- 本地/零成本：设置 QUEUE_DRIVER=inline（wrangler.jsonc → vars），导出任务在请求内联执行，不依赖 Cloudflare Queues。
- 切回真实队列：设置 QUEUE_DRIVER=queues，并确保 EXPORT_QUEUE 绑定有效（producers/consumers 指向相同队列）。
- API 契约不变：POST /api/reports/weekly/export → status?id → download?id。
