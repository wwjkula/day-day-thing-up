# 日事日清 · 本地运行版

该目录提供脱离 Cloudflare 的本地化部署方案。后端由 Node.js/Express 直接读写 `data/` 下的 JSON 文件，前端沿用现有 Vue 页面，功能覆盖工作项填报、周报、缺报提醒以及管理端 CRUD。

## 目录结构

- `server/`：Express API 与本地数据访问层
- `web/`：Vue 3 前端（使用 `../shared` 中的 DTO/校验）
- `shared/`：前后端共享类型与工具
- `data/`：JSON 数据源（用户、组织、角色、工作项等）
- `logs/`：预留日志目录
- `Dockerfile` & `docker-compose.yml`：容器化启动脚手架
- `启动Docker.cmd`：Windows 一键 Docker 启动脚本
- `start_local.py`：跨平台（Windows/macOS/Linux）本地启动脚本

## 运行方式

### 1. Docker（推荐，目标电脑无需预装 Node）

1. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop)。
2. 双击 `启动Docker.cmd`。
3. 初次执行会自动构建镜像并启动容器。完成后，浏览器访问 `http://localhost:8080/`（局域网其它设备使用 `http://<宿主机 IP>:8080/`）。
4. 数据、日志分别挂载到宿主机的 `./data`、`./logs`，升级镜像不会丢失。

常用命令：

```powershell
docker compose logs -f   # 查看实时日志
docker compose down      # 停止并移除容器
```

### 2. 本地 Node.js（适合开发调试）

1. 安装 Node.js ≥ 18。
2. 执行 `python start_local.py`：
   - 首次会自动运行 `npm install`、`npm install --prefix web`、`npm run build --prefix web`；
   - 完成后服务监听 `http://localhost:8080/`。

也可手动执行：

```powershell
npm install
npm install --prefix web
npm run build --prefix web
npm start
```

`start_local.py` 支持的参数：

```bash
python start_local.py --force-install       # 重新安装根依赖
python start_local.py --force-install-web   # 重新安装 web 依赖
python start_local.py --force-build         # 强制重新构建前端
python start_local.py --skip-build          # 跳过前端构建
```

## 管理员入口

- 登录凭据仍为 “工号 + 密码”。
- 通过 `role_grants.json` 中授予 `sys_admin` 角色判断管理员身份。
- 管理端路由 `/api/admin/*` 覆盖组织、人员、上下级关系、角色授权等 CRUD；所有操作写入 JSON 并追加审计日志。

## 数据存储说明

- 所有 JSON 均采用 `{ meta: { lastId }, items: [] }` 结构，ID 自增由后端维护；
- 工作项按用户拆分存储于 `data/work_items/user/{userId}.json`；
- 周报、缺报统计在内存中基于 JSON 动态计算，无需数据库；
- 审计日志写入同一 `data/` 目录，可按需备份。

## 注意事项

- 首次启动无需手动修改 `data/`，缺失的目录会自动创建；
- 修改 JSON 前建议停止服务，避免写入冲突；
- 如需重置管理员密码，可替换 `data/users.json` 中的 `passwordHash`（bcryptjs）。

如需扩展（定时任务、更多报表等），可在 `server/` 目录继续迭代，互不影响原 Cloudflare 部署。
