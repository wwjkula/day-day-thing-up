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
from typing import Optional

# Optional imports for UI will be resolved at runtime
try:
    from PyQt5 import QtWidgets  # type: ignore
    _PYQT5_AVAILABLE = True
except Exception:
    _PYQT5_AVAILABLE = False


def run_ui(args: argparse.Namespace) -> int:
    """Launch a minimal PyQt5 UI to manage local/tunnel start."""
    app = QtWidgets.QApplication(sys.argv)

    class MainWindow(QtWidgets.QWidget):
        def __init__(self):
            super().__init__()
            self.setWindowTitle("本地启动与内网穿透")
            self.server_proc: Optional[subprocess.Popen] = None
            self.ngrok_proc: Optional[subprocess.Popen] = None

            # Widgets
            self.mode = QtWidgets.QComboBox()
            self.mode.addItems(["off", "ngrok"])
            self.mode.setCurrentText((args.tunnel or "off").lower())

            self.port = QtWidgets.QSpinBox()
            self.port.setRange(1, 65535)
            self.port.setValue(int(args.port))

            self.token = QtWidgets.QLineEdit()
            self.token.setPlaceholderText("NGROK_AUTHTOKEN（留空沿用已配置）")
            if args.tunnel_token:
                self.token.setText(str(args.tunnel_token))
            self.token.setEchoMode(QtWidgets.QLineEdit.Password)

            self.domain = QtWidgets.QLineEdit()
            self.domain.setPlaceholderText("ngrok 自定义域名")
            if args.tunnel_domain:
                self.domain.setText(str(args.tunnel_domain))

            self.region = QtWidgets.QLineEdit()
            self.region.setPlaceholderText("ngrok 区域（留空默认）")
            if args.tunnel_region:
                self.region.setText(str(args.tunnel_region))

            self.forceInstall = QtWidgets.QCheckBox("强制后端依赖安装 (--force-install)")
            self.forceInstall.setChecked(bool(args.force_install))

            self.forceInstallWeb = QtWidgets.QCheckBox("强制前端依赖安装 (--force-install-web)")
            self.forceInstallWeb.setChecked(bool(args.force_install_web))

            self.forceBuild = QtWidgets.QCheckBox("强制前端构建 (--force-build)")
            self.forceBuild.setChecked(bool(args.force_build))

            self.skipBuild = QtWidgets.QCheckBox("跳过前端构建 (--skip-build)")
            self.skipBuild.setChecked(bool(args.skip_build))

            self.startBtn = QtWidgets.QPushButton("启动")
            self.stopBtn = QtWidgets.QPushButton("停止")
            self.stopBtn.setEnabled(False)

            self.localUrl = QtWidgets.QLineEdit()
            self.localUrl.setReadOnly(True)
            self.publicUrl = QtWidgets.QLineEdit()
            self.publicUrl.setReadOnly(True)

            self.openLocal = QtWidgets.QPushButton("打开本地")
            self.openPublic = QtWidgets.QPushButton("打开公网")

            self.log = QtWidgets.QPlainTextEdit()
            self.log.setReadOnly(True)

            # Layout
            form = QtWidgets.QFormLayout()
            form.addRow("模式 (off/ngrok)", self.mode)
            form.addRow("端口", self.port)
            form.addRow("Token", self.token)
            form.addRow("域名", self.domain)
            form.addRow("区域", self.region)
            form.addRow(self.forceInstall)
            form.addRow(self.forceInstallWeb)
            form.addRow(self.forceBuild)
            form.addRow(self.skipBuild)

            btns = QtWidgets.QHBoxLayout()
            btns.addWidget(self.startBtn)
            btns.addWidget(self.stopBtn)

            openBtns = QtWidgets.QHBoxLayout()
            openBtns.addWidget(self.openLocal)
            openBtns.addWidget(self.openPublic)

            v = QtWidgets.QVBoxLayout(self)
            v.addLayout(form)
            v.addLayout(btns)
            v.addWidget(QtWidgets.QLabel("本地地址 / 公网地址"))
            v.addWidget(self.localUrl)
            v.addWidget(self.publicUrl)
            v.addLayout(openBtns)
            v.addWidget(QtWidgets.QLabel("日志"))
            v.addWidget(self.log)

            # Signals
            self.startBtn.clicked.connect(self.on_start)
            self.stopBtn.clicked.connect(self.on_stop)
            self.openLocal.clicked.connect(lambda: self.open_url(self.localUrl.text()))
            self.openPublic.clicked.connect(lambda: self.open_url(self.publicUrl.text()))

        def append_log(self, text: str) -> None:
            self.log.appendPlainText(text)

        def open_url(self, url: str) -> None:
            if not url:
                return
            try:
                if platform.system().lower() == "windows":
                    os.startfile(url)  # type: ignore[attr-defined]
                elif platform.system().lower() == "darwin":
                    subprocess.run(["open", url], check=False)
                else:
                    subprocess.run(["xdg-open", url], check=False)
            except Exception:
                pass

        def on_start(self) -> None:
            self.append_log("开始启动...")
            self.startBtn.setEnabled(False)
            self.stopBtn.setEnabled(True)

            # Prepare options
            port = int(self.port.value())
            mode = self.mode.currentText().lower()
            token = self.token.text().strip() or None
            domain = self.domain.text().strip() or None
            region = self.region.text().strip() or None

            # Install/build as requested
            try:
                maybe_install_server(self.forceInstall.isChecked())
                maybe_install_web(self.forceInstallWeb.isChecked())
                maybe_build_web(self.forceBuild.isChecked(), self.skipBuild.isChecked())
            except subprocess.CalledProcessError as e:
                self.append_log(f"依赖/构建失败: {e}")
                self.startBtn.setEnabled(True)
                self.stopBtn.setEnabled(False)
                return

            # Start server
            try:
                self.server_proc = start_server_background(port)
                self.append_log(f"Node 服务已启动 (pid={self.server_proc.pid})，等待端口就绪...")
            except Exception as e:
                self.append_log(f"启动服务失败: {e}")
                self.startBtn.setEnabled(True)
                self.stopBtn.setEnabled(False)
                return

            if not wait_for_port(port, timeout=45):
                self.append_log("端口未在预期时间内打开。")
                return

            local_url = f"http://localhost:{port}"
            self.localUrl.setText(local_url)
            self.append_log(f"本地地址: {local_url}")

            # Start ngrok if needed
            if mode == "ngrok":
                try:
                    ngrok_config_add_authtoken(token)
                    self.ngrok_proc, public_url = start_ngrok_http(port, domain=domain, region=region)
                    if domain:
                        self.publicUrl.setText(public_url)
                        self.append_log(f"公网地址: {public_url}")
                    else:
                        self.append_log("ngrok 将分配临时域名，请查看控制台窗口。")
                except Exception as e:
                    self.append_log(f"启动 ngrok 失败: {e}")

        def on_stop(self) -> None:
            terminate_process(self.ngrok_proc, name="ngrok")
            terminate_process(self.server_proc, name="node server")
            self.ngrok_proc = None
            self.server_proc = None
            self.append_log("已停止。")
            self.startBtn.setEnabled(True)
            self.stopBtn.setEnabled(False)

        def closeEvent(self, event):  # noqa: N802
            self.on_stop()
            super().closeEvent(event)

    win = MainWindow()
    win.resize(720, 560)
    win.show()
    return app.exec_()

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


def start_server_background(port: int) -> subprocess.Popen:
    """Start the Node server as a background process and return the Popen handle."""
    ensure_port_available(port)
    cmd = resolve_cmd(["npm", "start"])
    env = os.environ.copy()
    env.setdefault("PORT", str(port))
    process = subprocess.Popen(cmd, cwd=ROOT, env=env)
    return process


def wait_for_port(port: int, host: str = "127.0.0.1", timeout: float = 30.0, interval: float = 0.5) -> bool:
    """Wait until the TCP port is open (listening)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(interval)
            try:
                s.connect((host, port))
                return True
            except OSError:
                pass
        time.sleep(interval)
    return False


def ensure_ngrok_available() -> None:
    ensure_tool("ngrok")


def ngrok_config_add_authtoken(token: Optional[str]) -> None:
    if token:
        # Safe to run repeatedly; ngrok will update config
        try:
            run(["ngrok", "config", "add-authtoken", token], check=True)
        except subprocess.CalledProcessError:
            print("[WARN] Failed to configure ngrok authtoken — continuing.")


def start_ngrok_http(port: int, domain: Optional[str] = None, region: Optional[str] = None) -> tuple[subprocess.Popen, str]:
    """Start an ngrok http tunnel for the given port. Returns (process, public_url)."""
    ensure_ngrok_available()
    cmd = ["ngrok", "http"]
    if region:
        cmd.append(f"--region={region}")
    if domain:
        cmd.append(f"--domain={domain}")
    cmd.append(str(port))
    print("\n==> " + " ".join(cmd))
    proc = subprocess.Popen(cmd, cwd=ROOT)
    public_url = f"https://{domain}" if domain else "(ngrok URL will be assigned)"
    return proc, public_url


def terminate_process(proc: Optional[subprocess.Popen], *, name: str = "process") -> None:
    if not proc:
        return
    if proc.poll() is not None:
        return
    system = platform.system().lower()
    try:
        if system == "windows":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/F", "/T"], check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
    except Exception:
        print(f"[WARN] Failed to terminate {name} (pid={getattr(proc, 'pid', '?')}).")


def run_with_ngrok_cli(port: int, *, token: Optional[str], domain: Optional[str], region: Optional[str]) -> int:
    """Start Node server and ngrok tunnel; keep running until either exits or interrupted."""
    print("\n=== Starting local server with ngrok tunnel (Ctrl+C to stop) ===")
    server_proc = None
    ngrok_proc = None
    try:
        server_proc = start_server_background(port)
        print(f"[INFO] Node server started (pid={server_proc.pid}), waiting for port {port}...")
        ok = wait_for_port(port, timeout=45)
        if not ok:
            print(f"[ERROR] Server port {port} did not open in time.")
            return 1

        ngrok_config_add_authtoken(token)
        ngrok_proc, public_url = start_ngrok_http(port, domain=domain, region=region)
        print(f"[READY] Local:  http://localhost:{port}")
        if domain:
            print(f"[READY] Public: {public_url}")
        else:
            print("[INFO] ngrok public URL will be shown in ngrok console.")

        # Wait for either process to exit
        while True:
            rc_server = server_proc.poll()
            rc_ngrok = ngrok_proc.poll()
            if rc_server is not None:
                print(f"[INFO] Node server exited with code {rc_server}.")
                return rc_server or 0
            if rc_ngrok is not None:
                print(f"[INFO] ngrok exited with code {rc_ngrok}.")
                return rc_ngrok or 0
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nInterrupted by user.")
        return 0
    finally:
        terminate_process(ngrok_proc, name="ngrok")
        terminate_process(server_proc, name="node server")


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
    # Tunneling options
    parser.add_argument(
        "--tunnel",
        choices=["off", "ngrok"],
        default=os.environ.get("TUNNEL", "off"),
        help="是否开启内网穿透：off | ngrok（默认 off）",
    )
    parser.add_argument(
        "--tunnel-token",
        default=os.environ.get("NGROK_AUTHTOKEN"),
        help="ngrok authtoken（优先读环境变量 NGROK_AUTHTOKEN）",
    )
    parser.add_argument(
        "--tunnel-domain",
        default=os.environ.get(
            "NGROK_DOMAIN",
            "overidolatrously-uninterjected-moshe.ngrok-free.dev",
        ),
        help="ngrok 自定义域名（默认使用提供的 ngrok-free 域名）",
    )
    parser.add_argument(
        "--tunnel-region",
        default=os.environ.get("NGROK_REGION"),
        help="ngrok 区域（留空与参考 start.py 一致）",
    )
    parser.add_argument(
        "--ui",
        action="store_true",
        help="使用 PyQt5 图形界面启动和管理",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    ensure_tool("node")
    ensure_tool("npm")

    maybe_install_server(args.force_install)
    maybe_install_web(args.force_install_web)
    maybe_build_web(args.force_build, args.skip_build)

    # UI mode
    if getattr(args, "ui", False):
        if not _PYQT5_AVAILABLE:
            print("[ERROR] PyQt5 未安装，无法使用 --ui 模式。请先 pip install PyQt5。")
            return 1
        return run_ui(args)

    # CLI mode
    tunnel = (args.tunnel or "off").lower()
    if tunnel == "ngrok":
        return run_with_ngrok_cli(
            args.port,
            token=args.tunnel_token,
            domain=args.tunnel_domain,
            region=args.tunnel_region,
        )
    else:
        return start_server(args.port)


if __name__ == "__main__":
    raise SystemExit(main())
