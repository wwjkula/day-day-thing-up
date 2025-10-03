#!/usr/bin/env python3
"""一键将本地运行版打包为 Docker 镜像的辅助脚本。

默认等价于：

    docker build -t rishiriqing-local:latest .

也可以通过参数自定义镜像名称、构建平台、是否推送等。
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def ensure_docker() -> str:
    docker_path = shutil.which("docker")
    if not docker_path:
        print("[ERROR] 未检测到 docker，请先安装 Docker Desktop 或 Docker CLI。")
        sys.exit(1)
    return docker_path


def ensure_docker_daemon() -> None:
    try:
        subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except subprocess.CalledProcessError:
        print("[ERROR] Docker 守护进程未运行，请先启动 Docker Desktop 再执行该脚本。")
        sys.exit(1)


def run(cmd: list[str]) -> None:
    print(f"\n==> {' '.join(cmd)} (cwd={ROOT})")
    subprocess.run(cmd, cwd=ROOT, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build Docker image for 本地运行版")
    parser.add_argument(
        "--tag",
        default="rishiriqing-local:latest",
        help="镜像名称:标签（默认 rishiriqing-local:latest）",
    )
    parser.add_argument(
        "--platform",
        default=None,
        help="可选的 --platform 参数，例如 linux/amd64",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="构建时不使用缓存 (docker build --no-cache)",
    )
    parser.add_argument(
        "--push",
        action="store_true",
        help="构建完成后执行 docker push",
    )
    return parser.parse_args()


def main() -> int:
    ensure_docker()
    ensure_docker_daemon()
    args = parse_args()

    cmd = ["docker", "build", "-t", args.tag]
    if args.platform:
        cmd.extend(["--platform", args.platform])
    if args.no_cache:
        cmd.append("--no-cache")
    cmd.append(".")

    try:
        run(cmd)
    except subprocess.CalledProcessError as err:
        if err.returncode != 0:
            print("[ERROR] 构建失败，请检查上面的 docker 输出。若 Docker Desktop 未启动，请先启动后重试。")
            print("[HINT] 如果下载基础镜像失败，建议先尝试执行：")
            print("        docker pull node:22-alpine")
            print("      并确认网络/代理允许访问 registry.docker.io")
        raise

    if args.push:
        run(["docker", "push", args.tag])

    print("\n[INFO] 镜像构建完成。")
    if args.push:
        print(f"[INFO] 已推送至远程：{args.tag}")
    else:
        print(f"[INFO] 可通过 'docker run --rm -p 8080:8080 {args.tag}' 进行测试。")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
