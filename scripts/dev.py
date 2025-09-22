#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键本地启动：Cloudflare Worker + Vue 前端（Vite）
- 安装依赖（可跳过）
- 执行 Prisma 迁移与种子（可跳过）
- 检查/自动补全 Vite 代理配置（/api 与 /dev -> 127.0.0.1:8787）（可跳过）
- 并发启动 wrangler dev 与 vite dev
- Ctrl+C 优雅退出

用法：
  python scripts/dev.py            # 正常全流程
  python scripts/dev.py --skip-install --skip-db  # 跳过安装与数据库
  python scripts/dev.py --no-patch-proxy          # 不修改 Vite 代理
  python scripts/dev.py --no-open                 # 不自动打开浏览器
"""

import argparse
import os
import sys
import subprocess
import threading
import time
import signal
import shutil
import re
import json
from urllib import request, error as urlerror
import webbrowser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
WEB_DIR = os.path.join(ROOT, 'apps', 'web')
WORKER_DIR = os.path.join(ROOT, 'apps', 'worker')
VITE_CFG = os.path.join(WEB_DIR, 'vite.config.ts')


def ensure_repo_root() -> None:
    if not os.path.exists(os.path.join(ROOT, 'pnpm-workspace.yaml')):
        print('[FATAL] 请在仓库根目录下运行 (包含 pnpm-workspace.yaml)。')
        sys.exit(1)


def run_cmd(cmd, cwd=None, check=True, env=None) -> int:
    print(f'[RUN] {cmd} (cwd={cwd or ROOT})')
    p = subprocess.Popen(cmd, cwd=cwd or ROOT, shell=True, env=(env or os.environ.copy()))
    ret = p.wait()
    if check and ret != 0:
        print(f'[FATAL] 命令失败：{cmd} (exit={ret})')
        sys.exit(ret)
    return ret


def capture_stream(prefix: str, proc: subprocess.Popen):
    def reader(stream, is_err=False):
        for line in iter(stream.readline, b''):
            try:
                s = line.decode('utf-8', errors='ignore').rstrip('\n')
            except Exception:
                s = str(line)
            print(f'[{prefix}] {s}')
        stream.close()
    threading.Thread(target=reader, args=(proc.stdout,), daemon=True).start()
    if proc.stderr and proc.stderr is not proc.stdout:
        threading.Thread(target=reader, args=(proc.stderr, True), daemon=True).start()


def start_bg(name: str, cmd: str, cwd=None) -> subprocess.Popen:
    print(f'[START] {name}: {cmd}')
    proc = subprocess.Popen(
        cmd,
        cwd=cwd or ROOT,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    capture_stream(name, proc)
    return proc


def stop_proc(proc: subprocess.Popen, name: str):
    if proc and proc.poll() is None:
        print(f'[STOP] 正在停止 {name} ...')
        try:
            if os.name == 'nt':
                proc.terminate()
            else:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.terminate()
            except Exception:
                pass
        try:
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def wait_health(url: str, timeout_sec: int = 40) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with request.urlopen(url, timeout=3) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode('utf-8', errors='ignore') or '{}')
                    if data.get('ok') is True:
                        print(f'[OK] 健康检查通过：{url}')
                        return True
        except Exception:
            pass
        time.sleep(1.0)
    print(f'[WARN] 健康检查超时：{url}')
    return False


def patch_vite_proxy() -> bool:
    """如果 vite.config.ts 没有 dev 代理，则自动插入 server.proxy 配置。返回是否修改。"""
    if not os.path.exists(VITE_CFG):
        print(f'[WARN] 未找到 {VITE_CFG}，跳过代理检查')
        return False
    with open(VITE_CFG, 'r', encoding='utf-8') as f:
        src = f.read()
    if "server:" in src and ("'/api'" in src or '"/api"' in src):
        print('[OK] Vite 已含有 server.proxy，跳过修改')
        return False
    # 粗略地在 export default defineConfig({ ... }) 的对象末尾前插入 server
    m = re.search(r"export\s+default\s+defineConfig\s*\(\s*\{", src)
    if not m:
        print('[WARN] 未能识别 defineConfig 结构，跳过自动修改')
        return False
    insert_pos = src.rfind('})')
    if insert_pos == -1:
        insert_pos = src.rfind('})\n')
    if insert_pos == -1:
        print('[WARN] 未能定位配置结束位置，跳过自动修改')
        return False
    snippet = ",\n  server: { proxy: { '/api': 'http://127.0.0.1:8787', '/dev': 'http://127.0.0.1:8787' } }\n"
    new_src = src[:insert_pos] + snippet + src[insert_pos:]
    backup = VITE_CFG + '.bak'
    try:
        shutil.copyfile(VITE_CFG, backup)
    except Exception:
        pass
    with open(VITE_CFG, 'w', encoding='utf-8') as f:
        f.write(new_src)
    print(f'[OK] 已为 Vite 注入 dev 代理（已备份到 {os.path.basename(backup)}）')
    return True



def read_wrangler_database_url() -> str | None:
    """从 apps/worker/wrangler.jsonc 读取 vars.DATABASE_URL（支持 JSONC 注释）。"""
    path = os.path.join(WORKER_DIR, 'wrangler.jsonc')
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            src = f.read()
        # 去掉注释
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        src = re.sub(r"^\s*//.*$", "", src, flags=re.M)
        data = json.loads(src)
        vars_ = data.get('vars') or {}
        url = vars_.get('DATABASE_URL')
        return url
    except Exception:
        return None


def approve_builds() -> None:
    """批准需要执行构建脚本的依赖（Prisma 相关）。"""
    try:
        run_cmd('pnpm --yes approve-builds prisma @prisma/client @prisma/engines', cwd=ROOT, check=False)
    except Exception:
        pass


def ensure_prisma_cli() -> None:
    """确保 prisma CLI 可用；若不可用，尝试批准构建并重新安装。"""
    ret = subprocess.call('pnpm --filter worker exec prisma -v', cwd=ROOT, shell=True)
    if ret != 0:
        approve_builds()
        run_cmd('pnpm install', cwd=ROOT)
        ret2 = subprocess.call('pnpm --filter worker exec prisma -v', cwd=ROOT, shell=True)
        if ret2 != 0:
            print('[FATAL] Prisma CLI 不可用。请手动执行 "pnpm --yes approve-builds prisma @prisma/client @prisma/engines" 后重试。')
            sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='一键启动 Worker + Web (Vite) 开发环境')
    parser.add_argument('--skip-install', action='store_true', help='跳过 pnpm install')
    parser.add_argument('--skip-db', action='store_true', help='跳过 Prisma 迁移与种子')
    parser.add_argument('--no-patch-proxy', action='store_true', help='不自动修改 Vite 代理')
    parser.add_argument('--no-open', action='store_true', help='不自动打开浏览器')
    args = parser.parse_args()

    ensure_repo_root()

    # 基础检查
    try:
        subprocess.check_call('pnpm -v', shell=True, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        print('[FATAL] 未检测到 pnpm，请先安装：npm i -g pnpm')
        sys.exit(1)

    if not args.skip_install:
        # 批准 Prisma 相关依赖的构建脚本并安装依赖
        run_cmd('pnpm --yes approve-builds prisma @prisma/client @prisma/engines', cwd=ROOT, check=False)
        run_cmd('pnpm install', cwd=ROOT)

    # 确保 prisma CLI 可用
    ensure_prisma_cli()

    db_url = read_wrangler_database_url() or os.environ.get('DATABASE_URL')

    if not args.skip_db:
        if not db_url:
            print('[FATAL] 未找到 DATABASE_URL。请在 apps/worker/wrangler.jsonc 的 vars 中配置，或设置环境变量 DATABASE_URL 后重试。')
            sys.exit(1)
        env_db = os.environ.copy()
        env_db['DATABASE_URL'] = db_url
        run_cmd('pnpm --filter worker exec prisma migrate deploy', cwd=ROOT, env=env_db)
        run_cmd('pnpm --filter worker exec prisma db seed', cwd=ROOT, env=env_db)

    if not args.no_patch_proxy:
        patch_vite_proxy()

    # 启动后端
    proc_worker = start_bg('worker', 'pnpm --filter worker dev', cwd=ROOT)
    try:
        wait_health('http://127.0.0.1:8787/health', timeout_sec=45)
    except Exception:
        pass

    # 启动前端
    proc_web = start_bg('web', 'pnpm --filter web dev', cwd=ROOT)

    # 尝试打开浏览器
    if not args.no_open:
        time.sleep(2)
        try:
            webbrowser.open('http://localhost:5173')
        except Exception:
            pass

    print('[INFO] 正在运行。按 Ctrl+C 结束。')

    # 等待并托管子进程生命周期
    try:
        while True:
            time.sleep(1.0)
            # 任一子进程退出则提示
            if proc_worker.poll() is not None:
                print('[ERROR] worker 进程已退出。')
                break
            if proc_web.poll() is not None:
                print('[ERROR] web 进程已退出。')
                break
    except KeyboardInterrupt:
        print('\n[INFO] 收到中断信号，正在清理...')
    finally:
        stop_proc(proc_web, 'web')
        stop_proc(proc_worker, 'worker')
        print('[DONE] 已退出。')


if __name__ == '__main__':
    main()

