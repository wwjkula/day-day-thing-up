@echo off
setlocal
cd /d %~dp0

echo === 日事日清 · 本地运行版 (Node) ===

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 未检测到 Node.js，请先安装 Node.js 18+。
  pause
  exit /b 1
)

if not exist node_modules (
  echo 安装后端依赖...
  npm install
)

if not exist web\node_modules (
  echo 安装前端依赖...
  npm install --prefix web
)

if not exist web\dist (
  echo 构建前端...
  npm run build --prefix web
)

echo 启动本地服务...
npm start

pause
