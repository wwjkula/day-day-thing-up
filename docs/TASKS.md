# 日事日清 / 周度汇总 —— 待办任务清单

优先级口径：P1（必须，主干闭环）> P2（体验/运营优化）> P3（增强/生态），遵循 Never break userspace。

## 今日焦点（进行中）
- [/] P1 实现导出权限与限流中间件（canExport）
  - 策略：按用户审计日志做 5 次/分钟 速率限制（429 RATE_LIMITED）
  - 审计：拒绝写入 export_denied（reason=rate_limit）
  - 范围：POST /api/reports/weekly/export（保持现有契约）

## 刚完成
- [x] P1 代码勘察与路由索引（Investigate/Triage）
- [x] P1 在下载端点加入审计（export_download）

## 待完成（短期）
- [ ] P1 最小验证用例（本地）：
  - 获取 /dev/token → 触发 export → status → download 正常闭环
  - 连续 6 次导出，最后 1 次返回 429（RATE_LIMITED），并留审计 export_denied
- [ ] P1（可选）将导出速率上限抽为 env：RATE_LIMIT_EXPORTS_PER_MIN（默认 5）
- [ ] P1 文档补充：在 docs/HANDOVER*.md 引用本 TASKS 清单与速率策略说明

## 后续路线（承接 docs/HANDOVER_FOR_SUCCESSOR_v5.md）
- [ ] P1 canExport 策略化扩展：时间窗限制、范围白名单（必要时）
- [ ] P1 缺报名单 API：/api/reports/missing-weekly
- [ ] P1 org_closure 与关键索引迁移 + 基准（PG）
- [ ] P1 CI + prisma.config.ts 迁移 + /dev/token 生产开关
- [ ] P1 队列驱动切换校验（QUEUE_DRIVER=queues）与 R2 绑定核验
- [ ] P2 导出命名/水印/分包 + 审计扩展
- [ ] P2 Cron 定时入队（周日 20:00）与过期导出清理
- [ ] P2 安全加固：JWT 时钟偏移与输入校验集中化
- [ ] P2 性能调优与分页策略
- [ ] P3 附件上传/展示、历史可见性快照、下属树与统计看板、AD/LDAP/企业微信

---

说明：
- canExport 采用“集合先行 + 策略与限流”的统一入口，不改变现有 API 契约。
- 审计全链路：export_request（已有）、export_denied（新增）、export_download（新增）。
- 若需更细粒度的策略（如 subtree 需特权），通过中间件内策略表实现。
