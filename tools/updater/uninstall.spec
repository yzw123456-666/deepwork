# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['D:/程序/项目/many agent/代码/tools/updater/uninstall.py'],
    pathex=[],
    binaries=[],
    datas=[('D:/程序/项目/many agent/代码/tools/updater/sources.json', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='uninstall',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['D:/程序/项目/many agent/代码/tools/updater/icon.ico'],
)
