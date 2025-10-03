# 日事日清 · 本地运行版

本目录提供脱离 Cloudflare 的纯内网部署方案。后端使用 Node.js 本地 JSON 存储，前端保留原 Vue 页面，实现与原先 Cloudflare 版本等价的功能（工作项填报、周报、缺报提醒、Excel 导出、管理员 CRUD 等）。

## 目录结构

- `server/`：Express 后端，直接读写 `data/*.json`
- `web/`：Vue 3 前端，保留原组件代码，别名指向 `../shared`
- `shared/`：前后端共用 DTO / 校验逻辑
- `data/`：现有数据（用户、组织、管理关系、工作项等）
- `exports/`：后端导出的 Excel 会写入此目录
- `logs/`：预留日志目录
- `Dockerfile`、`docker-compose.yml`：容器化运行脚手架
- `启动Docker版.cmd`、`启动本地版.cmd`：Windows 一键启动脚本

## 运行方式

### 1. Docker（推荐，适合目标电脑未装 Node 环境）

1. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. 双击 `启动Docker版.cmd`
3. 首次执行会自动构建镜像并运行容器。完成后浏览器访问 `http://localhost:8080/`（局域网其它电脑访问 `http://10.10.20.69:8080/`）。
4. 数据、导出文件与日志分别挂载到宿主机 `./data`、`./exports`、`./logs`，升级镜像不会丢数据。

常用命令：

```powershell
docker compose logs -f   # 查看实时日志
docker compose down      # 停止并移除容器
```

### 2. 本地 Node.js（适合开发调试）

1. 安装 Node.js ≥ 18
2. 双击 `启动本地版.cmd`
   - 首次会自动执行 `npm install`、`npm install --prefix web`、`npm run build --prefix web`
   - 完成后监听 `http://localhost:8080/`

手工执行也可：

```powershell
npm install
npm install --prefix web
npm run build --prefix web
npm start
```

## Excel 导出

`POST /api/reports/weekly/export` 会即时生成 Excel（SheetJS），保存在 `exports/{jobId}.xlsx`。前端轮询 `/status` 后自动下载，文件结构与 Cloudflare 版一致（`Summary`、`ByUser`、`Details` 三个 Sheet）。

## 管理员入口

- 仍然通过“工号 + 密码”登录
- 判断管理员逻辑：`role_grants.json` 中授予 `sys_admin` 角色
- 管理后台 `/api/admin/*` 覆盖组织、人员、上下级关系、角色授权等 CRUD，所有操作落盘并写入 `audit_logs.json`

## 数据存储说明

- 所有 JSON 以 `{ meta: { lastId }, items: [] }` 结构存储，自增 ID 由后端维护
- 工作项分用户存放：`data/work_items/user/{userId}.json`
- 缺报、周报统计均在内存根据 JSON 即时计算，无需外部数据库
- 导出、审计日志会追加写入，无需外部服务

## 注意事项

- 首次构建/启动前无需手动修改数据文件，后端会自动创建缺失目录
- 修改 JSON 数据前请停止服务，以免写入冲突
- 如果需要重置管理员密码，可在 `data/users.json` 中替换 `passwordHash`（`bcryptjs` 算法）
- 为保证内网性能，可定期清理 `exports/` 或归档 Excel

如需扩展功能（定时任务、更多报表等），可在 `server/` 内继续迭代，不影响现有 Cloudflare 版本。
