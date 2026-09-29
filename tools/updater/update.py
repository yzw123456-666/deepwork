#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deepwork 更新器（独立 GUI 程序，打包为 update.exe）
流程：
  1) 启动即做中断恢复：若发现上次更新残留的 .bak，自动还原，避免软件“消失”。
  2) 隐藏式线路选择：只显示“正在选择最优线路…”，对用户在界面上不暴露任何具体线路名。
  3) 拉取 version.json，与本地版本比较，判断是否真有更新。
  4) 下载完整 portable 压缩包到临时目录，实时显示进度 / 速度 / 剩余时间。
  5) sha256 校验，失败直接中止（不碰旧文件）。
  6) 备份旧 app 文件夹（整目录重命名为 .bak）。
  7) 解压新文件夹到原位；任意一步失败 → 从 .bak 还原并重启旧版。
  8) 成功 → 删除 .bak → 启动新 deepwork.exe → 退出。
多线路：GitHub / 文汇百川 / Gitee / GitCode / 我的服务器（yzw.silksky.com）。
"""

import sys
import os
import json
import time
import queue
import shutil
import subprocess
import argparse
import threading
import zipfile
import hashlib
import tempfile
import urllib.parse

try:
    import tkinter as tk
    from tkinter import ttk, messagebox
except ImportError:
    tk = ttk = messagebox = None

try:
    import requests
except ImportError:
    requests = None

DEFAULT_EXE_NAME = "deepwork.exe"
APP_VERSION = None  # 由主程序通过 --current-version 传入

# ---------- 线路配置（可覆盖：同目录 sources.json 优先）----------
DEFAULT_SOURCES = [
    {"name": "GitHub", "versionUrl": "https://github.com/yzw123456-666/deepwork/releases/latest/download/version.json"},
    {"name": "文汇百川", "versionUrl": "https://s100636-weba.publicos.cn/deepwork-update/version.json"},
    {"name": "Gitee", "versionUrl": "https://gitee.com/yzw123456-666/deepwork/releases/download/latest/version.json"},
    {"name": "GitCode", "versionUrl": "https://gitcode.com/yzw123456-666/deepwork/releases/download/latest/version.json"},
    {"name": "我的服务器", "versionUrl": "https://yzw.silksky.com/deepwork/version.json"},
]


def load_sources(exe_dir):
    p = os.path.join(exe_dir, "sources.json")
    try:
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("sources"):
                return data["sources"]
    except Exception:
        pass
    return DEFAULT_SOURCES


def compare_versions(a, b):
    def norm(v):
        return [int(x) for x in str(v or "0").split(".") if x.isdigit()]
    pa, pb = norm(a), norm(b)
    n = max(len(pa), len(pb))
    for i in range(n):
        x, y = (pa + [0] * n)[i], (pb + [0] * n)[i]
        if x > y:
            return 1
        if x < y:
            return -1
    return 0


# ---------- 网络 ----------
def fetch_json(url, timeout=12, verify=True):
    if requests:
        r = requests.get(url, timeout=timeout, verify=verify)
        r.raise_for_status()
        return r.json()
    else:
        import urllib.request
        ctx = None if verify else _no_verify_ctx()
        with urllib.request.urlopen(url, timeout=timeout, context=ctx) as resp:
            return json.loads(resp.read().decode("utf-8"))


def _no_verify_ctx():
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def download_file(url, dest, on_progress=None, timeout=30, verify=True):
    """流式下载，on_progress(received, total, speed_bps)。返回实际字节数。

    超时策略：连接 10s / 单次读取 30s（read timeout 是数据块间隔，不是总时长）。
    断网/线路中断最多 30 秒内报错，绝不长时间僵住界面。
    """
    req_timeout = (10, 30) if requests else 30
    if requests:
        r = requests.get(url, stream=True, timeout=req_timeout, verify=verify)
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0) or 0)
        received = 0
        start = time.time()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                if chunk:
                    f.write(chunk)
                    received += len(chunk)
                    now = time.time()
                    speed = received / (now - start + 1e-6)
                    if on_progress:
                        on_progress(received, total, speed)
        return received
    else:
        import urllib.request
        ctx = None if verify else _no_verify_ctx()
        with urllib.request.urlopen(url, timeout=req_timeout, context=ctx) as resp:
            total = int(resp.headers.get("Content-Length", 0) or 0)
            received = 0
            start = time.time()
            with open(dest, "wb") as f:
                while True:
                    buf = resp.read(65536)
                    if not buf:
                        break
                    f.write(buf)
                    received += len(buf)
                    now = time.time()
                    speed = received / (now - start + 1e-6)
                    if on_progress:
                        on_progress(received, total, speed)
            return received


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------- 文件操作 ----------
def safe_extract_zip(zip_path, dest_dir):
    """解压到 dest_dir，带路径穿越防护。"""
    os.makedirs(dest_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as z:
        for info in z.infolist():
            target = os.path.join(dest_dir, info.filename)
            # 防穿越
            if not os.path.abspath(target).startswith(os.path.abspath(dest_dir) + os.sep):
                if os.path.abspath(target) != os.path.abspath(dest_dir):
                    raise RuntimeError(f"压缩包含非法路径：{info.filename}")
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
            else:
                parent = os.path.dirname(target)
                if parent:
                    os.makedirs(parent, exist_ok=True)
                with z.open(info) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)


def backup_app(app_dir):
    """整目录重命名为 .bak，返回 bak 路径。"""
    bak = app_dir + ".bak"
    if os.path.exists(bak):
        shutil.rmtree(bak, ignore_errors=True)
    os.rename(app_dir, bak)
    return bak


def restore_backup(app_dir, bak):
    """从 .bak 还原（覆盖式）。"""
    if not os.path.exists(bak):
        return
    if os.path.exists(app_dir):
        shutil.rmtree(app_dir, ignore_errors=True)
    os.rename(bak, app_dir)


def launch_app(app_dir, exe_name):
    exe_path = os.path.join(app_dir, exe_name)
    if not os.path.exists(exe_path):
        raise RuntimeError(f"未找到启动程序：{exe_path}")
    subprocess.Popen([exe_path], cwd=app_dir)
    return exe_path


def fmt_size(n):
    if n <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024.0
        i += 1
    return f"{n:.1f} {units[i]}"


def fmt_speed(bps):
    if bps <= 0:
        return ""
    return f"{fmt_size(bps)}/s"


def fmt_eta(sec):
    if not sec or sec < 0 or sec > 86400:
        return "--"
    m = int(sec // 60)
    s = int(sec % 60)
    if m > 0:
        return f"{m}分{s}秒"
    return f"{s}秒"


# ---------- GUI ----------
class UpdaterApp:
    def __init__(self, root, app_dir, exe_name, sources, current_version, target_version=None, verify=True):
        self.root = root
        self.app_dir = app_dir
        self.exe_name = exe_name
        self.sources = sources
        self.current_version = current_version
        self.target_version = target_version
        self.verify = verify
        self.cancelled = False
        self.running = False
        self.critical = False  # 备份/替换/启动阶段为 True：禁止取消与关闭
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

    def _build_ui(self):
        self.root.title("deepwork 更新")
        self.root.geometry("460x320")
        self.root.resizable(False, False)
        self.root.configure(bg="#20232a")

        try:
            self.root.iconbitmap(os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "icon.ico"))
        except Exception:
            pass

        pad = {"padx": 24, "pady": 6}

        tk.Label(self.root, text="deepwork 更新", font=("Microsoft YaHei", 16, "bold"),
                 fg="#ffffff", bg="#20232a").pack(pady=(22, 4))

        self.status_var = tk.StringVar(value="准备中…")
        self.status = tk.Label(self.root, textvariable=self.status_var, font=("Microsoft YaHei", 11),
                               fg="#9aa4b2", bg="#20232a", wraplength=400)
        self.status.pack(padx=24, pady=(0, 10))

        self.progress = ttk.Progressbar(self.root, orient="horizontal", length=400, mode="determinate")
        self.progress.pack(padx=24, pady=(0, 8))

        self.detail_var = tk.StringVar(value="")
        self.detail = tk.Label(self.root, textvariable=self.detail_var, font=("Microsoft YaHei", 10),
                               fg="#6b7280", bg="#20232a")
        self.detail.pack(padx=24, pady=(0, 14))

        self.log_var = tk.StringVar(value="")
        self.log = tk.Label(self.root, textvariable=self.log_var, font=("Microsoft YaHei", 9),
                            fg="#4b5563", bg="#20232a", wraplength=400, justify="left")
        self.log.pack(padx=24, pady=(0, 10), fill="x")

        self.btn_frame = tk.Frame(self.root, bg="#20232a")
        self.btn_frame.pack(pady=(0, 16))
        self.cancel_btn = tk.Button(self.btn_frame, text="取消", width=12, command=self.on_cancel,
                                    bg="#2d313a", fg="#cbd5e1", activebackground="#3a3f4b",
                                    relief="flat", font=("Microsoft YaHei", 10))
        self.cancel_btn.pack()

        style = ttk.Style()
        style.theme_use("default")
        style.configure("TProgressbar", background="#3b82f6", troughcolor="#2d313a", thickness=10)

    def set_status(self, text):
        self.root.after(0, lambda: self.status_var.set(text))

    def set_detail(self, text):
        self.root.after(0, lambda: self.detail_var.set(text))

    def set_log(self, text):
        self.root.after(0, lambda: self.log_var.set(text))

    def set_progress(self, value, maximum=100):
        self.root.after(0, lambda: (self.progress.configure(maximum=maximum, value=value)
                                    if maximum else None))

    def on_cancel(self):
        if not self.running:
            self.root.destroy()
            return
        if getattr(self, "critical", False):
            # 备份/替换/启动阶段不可中断：中断会让软件处于半新半旧状态
            self.set_status("正在应用更新，无法取消，请稍候…")
            return
        self.cancelled = True
        self.set_status("正在取消…")
        # 兜底：工作线程可能阻塞在网络请求内部（无法被打断），4 秒内没自己退出就强制结束进程。
        # 强退是安全的——真正动旧文件的阶段已被 critical 禁止取消，此时代码只是探测/下载。
        self.root.after(4000, self._force_exit_if_stuck)

    def _force_exit_if_stuck(self):
        if self.running:
            os._exit(0)

    def on_close(self):
        # 更新中点窗口 × 等同于取消；关键阶段不允许关闭
        if self.running:
            self.on_cancel()
            return
        self.root.destroy()

    # ---- 核心流程（后台线程）----
    def run(self):
        self.running = True
        try:
            self.recover_if_needed()

            # 1) 选择线路（只显示“正在选择最优线路…”）
            self.set_status("正在选择最优线路…")
            self.set_detail("")
            self.set_log("")
            src, info = self.pick_source()
            if self.cancelled:
                self.finish_info("已取消更新。")
                return
            if not src:
                self.finish_error("无法连接任何更新线路，请稍后重试或检查网络。")
                return

            latest = str(info.get("version", ""))
            if compare_versions(latest, self.current_version) <= 0 and not self.target_version:
                self.finish_error(f"当前已是最新版本（v{self.current_version}）。")
                return

            notes = info.get("notes", "")
            if notes:
                self.set_log(notes[:200])

            asset = info.get("asset")
            expected_sha = info.get("sha256")
            size = int(info.get("size", 0) or 0)

            # 2) 下载（主地址失败自动切备用镜像，界面只提示"切换备用线路"不暴露线路名）
            self.set_status("正在下载更新包…")
            tmp = tempfile.mkdtemp(prefix="dw-upd-")
            zip_path = os.path.join(tmp, "update.zip")
            last_t = [0, 0]

            def on_progress(received, total, speed):
                if self.cancelled:
                    raise InterruptedError("用户取消")
                pct = (received / total * 100) if total else 0
                self.set_progress(int(pct), 100)
                if total:
                    eta = (total - received) / speed if speed else 0
                    self.set_detail(f"{fmt_size(received)} / {fmt_size(total)}  ·  {fmt_speed(speed)}  ·  剩余 {fmt_eta(eta)}")
                else:
                    self.set_detail(f"{fmt_size(received)}  ·  {fmt_speed(speed)}")

            urls = [u for u in [asset] + list(info.get("mirrors") or []) if isinstance(u, str) and u]
            downloaded = False
            last_err = None
            for attempt, u in enumerate(urls):
                if self.cancelled:
                    shutil.rmtree(tmp, ignore_errors=True)
                    self.finish_info("已取消更新。")
                    return
                try:
                    if attempt > 0:
                        self.set_log(f"当前线路下载不畅，自动切换备用线路（{attempt + 1}/{len(urls)}）…")
                        self.set_detail("")
                        self.set_progress(0, 100)
                    download_file(u, zip_path, on_progress, verify=self.verify)
                    downloaded = True
                    break
                except InterruptedError:
                    shutil.rmtree(tmp, ignore_errors=True)
                    self.finish_info("已取消更新。")
                    return
                except Exception as e:
                    last_err = e
                    continue

            if not downloaded:
                shutil.rmtree(tmp, ignore_errors=True)
                msg = str(last_err or "")
                if "connection" in msg.lower() or "timeout" in msg.lower() or "network" in msg.lower() or "resolve" in msg.lower():
                    self.finish_error("下载失败：网络连接中断或超时，请检查网络后重试。")
                else:
                    self.finish_error(f"下载失败：{msg}")
                return

            if self.cancelled:
                shutil.rmtree(tmp, ignore_errors=True)
                self.finish_info("已取消更新。")
                return

            # 3) 校验
            self.set_status("正在校验更新包…")
            self.set_progress(100, 100)
            actual_sha = sha256_of(zip_path)
            if expected_sha and actual_sha.lower() != str(expected_sha).lower():
                shutil.rmtree(tmp, ignore_errors=True)
                self.finish_error("更新包校验失败（sha256 不匹配），已中止以确保安全。")
                return

            # ---- 以下为关键阶段：动旧文件，禁止取消/关闭 ----
            self.critical = True
            try:
                self.cancel_btn.configure(state="disabled", text="更新中…")
            except Exception:
                pass

            # 4) 备份
            self.set_status("正在备份当前版本…")
            bak = backup_app(self.app_dir)
            self.set_log(f"已备份旧版本到 {os.path.basename(bak)}")

            # 5) 解压 + 替换
            try:
                self.set_status("正在应用更新…")
                safe_extract_zip(zip_path, self.app_dir)
            except Exception as e:
                restore_backup(self.app_dir, bak)
                shutil.rmtree(tmp, ignore_errors=True)
                self.finish_error(f"更新失败，已还原旧版本：{e}")
                return

            shutil.rmtree(tmp, ignore_errors=True)

            # 6) 成功：先启动新版，再删备份
            self.set_status("更新完成，正在启动…")
            self.set_progress(100, 100)
            try:
                launch_app(self.app_dir, self.exe_name)
            except Exception as e:
                # 启动失败也要保留备份以便手动恢复
                self.finish_error(f"新版本启动失败：{e}（旧版本备份仍在 .bak）")
                return
            time.sleep(1.5)
            if os.path.exists(bak):
                shutil.rmtree(bak, ignore_errors=True)
            self.running = False
            self.root.after(800, self.root.destroy)
        except Exception as e:
            self.finish_error(f"更新过程出错：{e}")

    def pick_source(self):
        """并发探测各线路 version.json，取最快成功者。界面不显示具体线路名。

        旧版串行探测（每线路 10s 超时 × 5 条，其中多条未开通线路必然挂起）
        导致界面卡在「正在选择最优线路…」近一分钟。现改为：全部线路同时起跑，
        最先成功返回的就是最优线路；整体 12 秒兜底，超时/全失败返回 (None, None)。
        探测线程为 daemon，残留线程不会阻塞进程退出。
        """
        sources = [s for s in self.sources if s.get("versionUrl")]
        if not sources:
            return (None, None)
        q: "queue.Queue" = queue.Queue()

        def probe(s):
            try:
                t0 = time.time()
                info = fetch_json(s["versionUrl"], timeout=5, verify=self.verify)
                latency = time.time() - t0
                if info and info.get("version") and info.get("asset"):
                    q.put((s, info, latency))
            except Exception:
                pass

        for s in sources:
            threading.Thread(target=probe, args=(s,), daemon=True).start()

        deadline = time.time() + 12
        while time.time() < deadline:
            if self.cancelled:
                return (None, None)
            try:
                s, info, _lat = q.get(timeout=0.25)
                # 并发起跑下最先成功的即最快线路，直接采用
                return (s, info)
            except queue.Empty:
                continue
        return (None, None)

    def recover_if_needed(self):
        """启动时若发现残留 .bak：app 没了就还原，app 在就清掉 .bak。"""
        bak = self.app_dir + ".bak"
        if os.path.exists(bak):
            if not os.path.exists(self.app_dir):
                restore_backup(self.app_dir, bak)
                self.set_log("检测到上次更新中断，已自动恢复旧版本。")
            else:
                shutil.rmtree(bak, ignore_errors=True)

    def finish_error(self, msg):
        self.running = False
        self.status_var.set("更新失败")
        self.detail_var.set("")
        self.log_var.set(msg)
        try:
            self.cancel_btn.configure(text="关闭", state="normal")
        except Exception:
            pass
        self.root.after(0, lambda: messagebox.showerror("deepwork 更新", msg))

    def finish_info(self, msg):
        self.running = False
        self.status_var.set(msg)
        try:
            self.cancel_btn.configure(text="关闭", state="normal")
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", default=None, help="app 文件夹路径（默认 update.exe 所在目录）")
    parser.add_argument("--exe-name", default=DEFAULT_EXE_NAME)
    parser.add_argument("--current-version", default=None)
    parser.add_argument("--target-version", default=None)
    parser.add_argument("--insecure", action="store_true", help="跳过 TLS 校验（仅测试用）")
    args = parser.parse_args()

    exe_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    app_dir = args.app_dir or exe_dir
    app_dir = os.path.abspath(app_dir)
    current = args.current_version
    sources = load_sources(exe_dir)

    root = tk.Tk()
    app = UpdaterApp(root, app_dir, args.exe_name, sources, current,
                     target_version=args.target_version, verify=not args.insecure)
    threading.Thread(target=app.run, daemon=True).start()
    root.mainloop()


if __name__ == "__main__":
    main()
