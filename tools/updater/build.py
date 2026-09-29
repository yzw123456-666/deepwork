#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
打包 deepwork 更新器 / 卸载器为独立 exe（PyInstaller）。
输出：
  dist/update.exe
  dist/uninstall.exe
用法：python build.py
"""
import os
import sys
import subprocess
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "dist")
PY = sys.executable

# 寻找 pyinstaller（优先 venv，其次 PATH）
pyinstaller = os.path.join(os.path.dirname(PY), "Scripts", "pyinstaller.exe")
if not os.path.exists(pyinstaller):
    pyinstaller = "pyinstaller"


def build(script, out_name):
    out = os.path.join(DIST, out_name)
    if os.path.exists(out):
        os.remove(out)
    cmd = [
        pyinstaller,
        "--noconsole",
        "--onefile",
        f"--name={out_name}",
        f"--icon={os.path.join(HERE, 'icon.ico')}",
        f"--add-data={os.path.join(HERE, 'sources.json')};.",
        script,
    ]
    print(">>>", " ".join(cmd))
    subprocess.run(cmd, cwd=HERE, check=True)


if __name__ == "__main__":
    os.makedirs(DIST, exist_ok=True)
    # 可选参数：只打指定目标（python build.py update / uninstall）；缺省全打
    only = sys.argv[1] if len(sys.argv) > 1 else None
    targets = [("update.py", "update"), ("uninstall.py", "uninstall")]
    for script, name in targets:
        if only and only not in (name, script):
            continue
        build(os.path.join(HERE, script), name)
    print("BUILD OK ->", DIST)
