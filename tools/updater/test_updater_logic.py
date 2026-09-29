#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""无界面验证 update.py 的核心逻辑：下载 / sha256 / 备份 / 解压 / 恢复。"""
import os, sys, json, zipfile, shutil, threading, http.server, socketserver, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import update as U

WORK = os.path.join(HERE, "_test_work")
SVR = os.path.join(WORK, "server")
APP_OLD = os.path.join(WORK, "app_old")
APP_NEW = os.path.join(WORK, "app_new")

def build():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(SVR, exist_ok=True)
    os.makedirs(APP_OLD, exist_ok=True)
    with open(os.path.join(APP_OLD, "old.txt"), "w") as f: f.write("OLD-VERSION")
    os.makedirs(APP_NEW, exist_ok=True)
    with open(os.path.join(APP_NEW, "deepwork.exe"), "w") as f: f.write("FAKE-EXE")
    with open(os.path.join(APP_NEW, "new.txt"), "w") as f: f.write("NEW-VERSION")
    zip_path = os.path.join(SVR, "update.zip")
    with zipfile.ZipFile(zip_path, "w") as z:
        for root, _, files in os.walk(APP_NEW):
            for fn in files:
                fp = os.path.join(root, fn)
                z.write(fp, os.path.relpath(fp, APP_NEW))
    sha = U.sha256_of(zip_path)
    size = os.path.getsize(zip_path)
    with open(os.path.join(SVR, "version.json"), "w") as f:
        json.dump({"version": "99.0.0", "asset": "PLACEHOLDER/update.zip",
                   "sha256": sha, "size": size, "notes": "test"}, f)
    return zip_path, sha, size

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def start_server():
    os.chdir(SVR)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Q)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port

def main():
    zip_path, sha, size = build()
    httpd, port = start_server()
    base = f"http://127.0.0.1:{port}"
    print(f"[server] port={port} zip_sha={sha[:12]}…")

    # 1) 下载 + 校验
    dl = os.path.join(WORK, "downloaded.zip")
    prog = []
    U.download_file(f"{base}/update.zip", dl, on_progress=lambda r, t, s: prog.append((r, t)))
    assert os.path.exists(dl), "下载失败"
    assert U.sha256_of(dl) == sha, "sha256 不匹配"
    print(f"[ok] 下载 {size} 字节，sha256 校验通过，进度回调 {len(prog)} 次")

    # 2) 备份旧 app（整目录重命名）
    app_dir = APP_OLD
    bak = U.backup_app(app_dir)
    assert not os.path.exists(app_dir) and os.path.exists(bak), "备份失败"
    print("[ok] 备份旧 app -> app_old.bak（原目录已移走）")

    # 3) 解压新 app
    U.safe_extract_zip(dl, app_dir)
    assert os.path.exists(os.path.join(app_dir, "new.txt")), "解压缺文件"
    assert os.path.exists(os.path.join(app_dir, "deepwork.exe")), "解压缺 exe"
    print("[ok] 解压新 app 成功（含 deepwork.exe / new.txt）")

    # 4) 模拟失败恢复：用 .bak 还原
    U.restore_backup(app_dir, bak)
    assert os.path.exists(os.path.join(app_dir, "old.txt")), "恢复失败"
    assert not os.path.exists(os.path.join(app_dir, "new.txt")), "恢复后残留新文件"
    print("[ok] 从 .bak 恢复旧版本成功（防崩溃回滚验证通过）")

    # 5) version.json 字段读取 + 版本比较
    import requests
    info = requests.get(f"{base}/version.json", timeout=5).json()
    assert U.compare_versions(info["version"], "26.9.65") > 0
    assert U.compare_versions("26.9.66", "26.9.66") == 0
    print("[ok] version.json 解析 + 版本比较正确")

    # 6) pick_source 并发探测（修「一直卡在选择线路」）：挂起线路不拖死选择
    from types import SimpleNamespace
    hang_url = "http://10.255.255.1/version.json"  # 不可路由 IP：connect 挂起到超时，模拟死线路
    mock = SimpleNamespace(
        sources=[{"name": "hang", "versionUrl": hang_url},
                 {"name": "good", "versionUrl": f"{base}/version.json"}],
        cancelled=False, verify=True)
    t0 = time.time()
    s, info = U.UpdaterApp.pick_source(mock)
    cost = time.time() - t0
    assert s and info and info.get("version") == "99.0.0", f"应选中可用线路，实际 {s} {info}"
    assert cost < 3, f"并发探测应立即返回可用线路，实际耗时 {cost:.1f}s（串行会被挂起线路拖住）"
    print(f"[ok] pick_source 并发探测：挂起线路不拖累，{cost:.2f}s 内选中可用线路")

    # 7) 全部线路不可达 → 约 12s 兜底返回，不永久卡住
    mock2 = SimpleNamespace(
        sources=[{"name": "hang1", "versionUrl": hang_url},
                 {"name": "hang2", "versionUrl": "http://10.255.255.1/other.json"}],
        cancelled=False, verify=True)
    t0 = time.time()
    s2, info2 = U.UpdaterApp.pick_source(mock2)
    cost2 = time.time() - t0
    assert s2 is None and info2 is None, "全部不可达应返回 (None, None)"
    assert 9 <= cost2 <= 20, f"应有 12s 兜底，实际 {cost2:.1f}s"
    print(f"[ok] pick_source 全部不可达：{cost2:.1f}s 兜底返回，不会永久卡住")

    httpd.shutdown()
    shutil.rmtree(WORK, ignore_errors=True)
    print("\n=== 更新器核心逻辑全部通过 ===")

if __name__ == "__main__":
    main()
