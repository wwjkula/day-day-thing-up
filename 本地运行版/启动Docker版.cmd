@echo off
setlocal
cd /d %~dp0

echo === 日事日清 · 本地运行版 (Docker) ===
docker --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 未检测到 Docker，请先安装 Docker Desktop。
  pause
  exit /b 1
)

echo.
echo 正在构建并启动容器...
docker compose up -d --build
if errorlevel 1 (
  echo [ERROR] 启动失败，请检查上方日志。
  pause
  exit /b 1
)

echo.
echo 部署完成，可访问 http://localhost:8080/
echo 如在局域网内，请改用本机 IP（例：10.10.20.69:8080）。
pause
