# 导出与队列驱动（零成本模式）

本仓库支持在本地零成本跑通“周度导出”全链路，无需开启 Cloudflare Queues：

## 一、环境配置
- R2：确保 wrangler.jsonc 已绑定本地桶（示例：day-day-thing-up-15976，binding=R2_EXPORTS）
- 队列驱动：在 wrangler.jsonc → vars 设置：
  - QUEUE_DRIVER=inline  （零成本/本地建议）
  - 可选：QUEUE_DRIVER=queues（切回真实队列时使用）

## 二、运行与验证
1) 启动本地 Worker：
   pnpm -C apps/worker dev
2) 获取 token（仅本地）：
   GET /dev/token?sub=1
3) 触发导出（示例）：
   POST /api/reports/weekly/export?from=2025-09-08&to=2025-09-14&scope=self
4) 轮询状态：
   GET  /api/reports/weekly/export/status?id=<jobId>
5) 下载产物（application/zip）：
   GET  /api/reports/weekly/export/download?id=<jobId>

说明：inline 驱动下产物会很快可用；API 契约保持不变。

## 三、切回 Cloudflare Queues（可选）
- 将 vars 中的 QUEUE_DRIVER 改为 queues
- 确保 wrangler.jsonc 已绑定 EXPORT_QUEUE（producers/consumers 指向同一队列）
- 代码无需改动，API 契约不变

## 四、注意事项
- Never break userspace：保持现有路由与下载行为；仅通过驱动切换实现“是否使用队列”
- 统一口径：周一为周首、标题≤20 字、服务端权限过滤与审计不可省略
- 生产环境请使用 wrangler secret 注入 DATABASE_URL/JWT_SECRET 等敏感信息，勿提交版本库

