#!/usr/bin/env python3
"""Bootstrap script for the local Node runtime.

This helper performs the following steps:

1. 检查 `node` / `npm` 是否可用。
2. 若缺少 `node_modules/`，自动执行 `npm install`（可通过参数强制重新安装）。
3. 若缺少 `web/node_modules/`，自动执行 `npm install --prefix web`。
4. 若缺少 `web/dist/`，自动执行 `npm run build --prefix web`（可强制/跳过）。
5. 启动 `npm start`，并在端口被占用时尝试自动杀掉占用进程。

示例：

    python start_local.py
    python start_local.py --force-build
    python start_local.py --skip-build --port 9090

"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
TOOLS: dict[str, str] = {}


def ensure_tool(name: str) -> None:
    path = shutil.which(name)
    if path is None:
        print(f"[ERROR] 必需工具 '{name}' 不在 PATH 中，请先安装。")
        sys.exit(1)
    TOOLS[name] = path


def resolve_cmd(cmd: list[str]) -> list[str]:
    if not cmd:
        return cmd
    first = cmd[0]
    if first in TOOLS:
        return [TOOLS[first], *cmd[1:]]
    return cmd


def run(cmd: list[str], *, cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess:
    cwd = cwd or ROOT
    full_cmd = resolve_cmd(cmd)
    print(f"\n==> {' '.join(full_cmd)} (cwd={cwd})")
    return subprocess.run(full_cmd, cwd=cwd, check=check)


def maybe_install_server(force: bool) -> None:
    if force or not (ROOT / "node_modules").exists():
        run(["npm", "install"])


def maybe_install_web(force: bool) -> None:
    if force or not (WEB_DIR / "node_modules").exists():
        run(["npm", "install", "--prefix", "web"])


def maybe_build_web(force: bool, skip: bool) -> None:
    if skip:
        print("跳过前端构建（--skip-build）。")
        return
    if force or not (WEB_DIR / "dist").exists():
        run(["npm", "run", "build", "--prefix", "web"])
    else:
        print("web/dist 已存在，若需重新构建请使用 --force-build。")


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
        except OSError:
            return True
    return False


def find_pids_for_port(port: int) -> list[int]:
    system = platform.system().lower()
    pids: set[int] = set()
    try:
        if system == "windows":
            output = subprocess.check_output(
                ["netstat", "-ano"], text=True, encoding="utf-8", errors="ignore"
            )
            needle = f":{port}"
            for line in output.splitlines():
                if needle in line and "LISTEN" in line.upper():
                    parts = line.split()
                    if parts:
                        pid_str = parts[-1]
                        if pid_str.isdigit():
                            pids.add(int(pid_str))
        else:
            try:
                output = subprocess.check_output(
                    ["lsof", "-i", f":{port}", "-sTCP:LISTEN", "-t"], text=True
                )
                for line in output.splitlines():
                    line = line.strip()
                    if line.isdigit():
                        pids.add(int(line))
            except (subprocess.CalledProcessError, FileNotFoundError):
                try:
                    output = subprocess.check_output(["ss", "-ltnp"], text=True)
                    needle = f":{port}"
                    for line in output.splitlines():
                        if needle not in line or "pid=" not in line:
                            continue
                        segments = line.split("pid=")
                        for segment in segments[1:]:
                            digits = []
                            for ch in segment:
                                if ch.isdigit():
                                    digits.append(ch)
                                else:
                                    break
                            if digits:
                                pids.add(int("".join(digits)))
                except (subprocess.CalledProcessError, FileNotFoundError):
                    pass
    except Exception:
        pass
    return sorted(pids)


def kill_processes(pids: list[int]) -> None:
    if not pids:
        return
    system = platform.system().lower()
    for pid in pids:
        try:
            if system == "windows":
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/F", "/T"],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


def ensure_port_available(port: int, *, auto_kill: bool = True, wait: float = 2.0) -> None:
    if not port_in_use(port):
        return
    pids = find_pids_for_port(port)
    if not auto_kill or not pids:
        print(f"[ERROR] 端口 {port} 已被占用，无法自动释放。占用进程: {pids or '未知'}")
        sys.exit(1)
    print(f"[INFO] 端口 {port} 被进程 {pids} 占用，尝试强制结束...")
    kill_processes(pids)
    time.sleep(wait)
    if port_in_use(port):
        print(f"[ERROR] 无法释放端口 {port}，请手动结束占用进程后重试。")
        sys.exit(1)
    print(f"[INFO] 已成功释放端口 {port}。")


def start_server(port: int) -> int:
    print("\n=== Starting local server (Ctrl+C to stop) ===")
    ensure_port_available(port)
    try:
        cmd = resolve_cmd(["npm", "start"])
        env = os.environ.copy()
        env.setdefault("PORT", str(port))
        process = subprocess.Popen(cmd, cwd=ROOT, env=env)
        process.wait()
        return process.returncode or 0
    except KeyboardInterrupt:
        print("\nServer interrupted by user.")
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap the local Node runtime")
    parser.add_argument(
        "--force-install",
        action="store_true",
        help="即使存在 node_modules 也重新运行 npm install",
    )
    parser.add_argument(
        "--force-install-web",
        action="store_true",
        help="即使存在 web/node_modules 也重新安装前端依赖",
    )
    parser.add_argument(
        "--force-build",
        action="store_true",
        help="无条件重新构建 web 前端",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="跳过前端构建",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8080")),
        help="启动服务使用的端口（默认 8080 或环境变量 PORT）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    ensure_tool("node")
    ensure_tool("npm")

    maybe_install_server(args.force_install)
    maybe_install_web(args.force_install_web)
    maybe_build_web(args.force_build, args.skip_build)

    return start_server(args.port)


if __name__ == "__main__":
    raise SystemExit(main())
