#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deepwork 卸载器（独立 GUI 程序，打包为 uninstall.exe）
便携版：直接删除 app 文件夹 + 清理快捷方式 + 可选删除个人数据（%APPDATA%/deepwork）。
因 uninstall.exe 自身位于待删文件夹内，采用“自我复制到临时目录再删除原目录”的标准自卸载方式。
"""

import sys
import os
import shutil
import subprocess
import time
import threading
import tkinter as tk
from tkinter import ttk, messagebox

try:
    import winreg
except ImportError:
    winreg = None

APP_NAME = "deepwork"
APPDATA_DIRNAME = "deepwork"  # 与 electron 主程序 userData 一致


def app_dir_of(exe_path):
    return os.path.dirname(os.path.abspath(exe_path))


def remove_shortcuts():
    """尽力清理桌面 / 开始菜单 / AppData 下的 deepwork 快捷方式。"""
    candidates = []
    env = os.environ
    if env.get("USERPROFILE"):
        base = env["USERPROFILE"]
        candidates.append(os.path.join(base, "Desktop"))
        candidates.append(os.path.join(base, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs"))
    if env.get("ALLUSERSPROFILE"):
        candidates.append(os.path.join(env["ALLUSERSPROFILE"], "Microsoft", "Windows", "Start Menu", "Programs"))
    for d in candidates:
        try:
            for name in os.listdir(d):
                if name.lower().startswith(APP_NAME) and name.lower().endswith(".lnk"):
                    try:
                        os.remove(os.path.join(d, name))
                    except Exception:
                        pass
        except Exception:
            pass


def remove_registry():
    """尽力删除 NSIS 安装留下的卸载注册表项（需要权限，失败忽略）。"""
    if not winreg:
        return
    for hive, sub in [
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]:
        try:
            with winreg.OpenKey(hive, sub, 0, winreg.KEY_READ) as key:
                i = 0
                while True:
                    name = winreg.EnumKey(key, i)
                    i += 1
                    if APP_NAME.lower() in name.lower():
                        try:
                            winreg.DeleteKey(key, name)
                        except Exception:
                            pass
        except Exception:
            pass


def run_delete(app_dir, purge_data):
    try:
        time.sleep(1.2)
        remove_shortcuts()
        remove_registry()
        if purge_data:
            ad = os.path.join(os.environ.get("APPDATA", ""), APPDATA_DIRNAME)
            if ad and os.path.exists(ad):
                shutil.rmtree(ad, ignore_errors=True)
        if os.path.exists(app_dir):
            shutil.rmtree(app_dir, ignore_errors=True)
    except Exception:
        pass
    finally:
        # 自删临时副本
        try:
            if getattr(sys, "frozen", False) or ".exe" in os.path.basename(sys.executable):
                os.remove(sys.executable)
        except Exception:
            pass


# ---------- GUI ----------
class UninstallApp:
    def __init__(self, root, exe_path):
        self.root = root
        self.exe_path = exe_path
        self.app_dir = app_dir_of(exe_path)
        self.purge = tk.BooleanVar(value=False)
        self._build()

    def _build(self):
        self.root.title("卸载 deepwork")
        self.root.geometry("440x280")
        self.root.resizable(False, False)
        self.root.configure(bg="#20232a")

        tk.Label(self.root, text="卸载 deepwork", font=("Microsoft YaHei", 16, "bold"),
                 fg="#ffffff", bg="#20232a").pack(pady=(22, 6))

        info = (f"将卸载 deepwork（位于：\n{self.app_dir}）\n"
                f"该操作会删除程序文件，且不可恢复。")
        tk.Label(self.root, text=info, font=("Microsoft YaHei", 10), fg="#9aa4b2", bg="#20232a",
                 wraplength=380, justify="left").pack(padx=24, pady=(0, 12))

        cb = tk.Checkbutton(self.root, text="同时删除我的数据（设置、对话记录等）",
                            variable=self.purge, bg="#20232a", fg="#cbd5e1",
                            selectcolor="#2d313a", activebackground="#20232a",
                            font=("Microsoft YaHei", 10), anchor="w")
        cb.pack(padx=24, fill="x", pady=(0, 18))

        f = tk.Frame(self.root, bg="#20232a")
        f.pack(pady=(0, 16))
        tk.Button(f, text="取消", width=12, command=self.root.destroy,
                  bg="#2d313a", fg="#cbd5e1", relief="flat", font=("Microsoft YaHei", 10)).pack(side="left", padx=8)
        tk.Button(f, text="卸载", width=12, command=self.on_uninstall,
                  bg="#ef4444", fg="#ffffff", relief="flat", font=("Microsoft YaHei", 10)).pack(side="left", padx=8)

    def on_uninstall(self):
        if not messagebox.askyesno("确认卸载", "确定要卸载 deepwork 吗？此操作不可恢复。"):
            return
        # 复制到临时目录后由其执行删除（避免删除自身所在文件夹失败）
        tmp = os.path.join(os.environ.get("TEMP", "."), "deepwork-uninstall-tmp.exe")
        try:
            shutil.copyfile(self.exe_path, tmp)
        except Exception:
            tmp = self.exe_path  # 退回：原地尝试（可能失败但不崩）
        args = [tmp, "--delete", self.app_dir]
        if self.purge.get():
            args.append("--purge")
        try:
            subprocess.Popen(args)
        except Exception as e:
            messagebox.showerror("卸载失败", str(e))
            return
        self.root.destroy()


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--delete":
        app_dir = sys.argv[2] if len(sys.argv) > 2 else None
        purge = "--purge" in sys.argv
        if app_dir:
            run_delete(app_dir, purge)
        return
    root = tk.Tk()
    UninstallApp(root, os.path.abspath(sys.argv[0]))
    root.mainloop()


if __name__ == "__main__":
    main()
