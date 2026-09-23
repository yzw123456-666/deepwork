# -*- coding: utf-8 -*-
"""生成 deepwork 原子图标：resources/icon.png（256/512）+ resources/icon.ico（多尺寸）。
与 src/components/AppLogo.tsx 同款造型：深色圆底 + 两条浅青交叉轨道 + 中心核 + 三个电子。
"""
from PIL import Image, ImageDraw
import math, os

DARK = (34, 38, 47, 255)        # #22262F 圆底
CYAN = (169, 233, 227, 255)     # #A9E9E3 轨道/电子

S = 1024  # 超采样画布
cx = cy = S / 2
R = S / 2

base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(base)
d.ellipse([0, 0, S - 1, S - 1], fill=DARK)

def orbit(angle_deg, rx_ratio=0.42, ry_ratio=0.19, width=40):
    """画一条旋转的椭圆轨道（先在透明层画正椭圆，再旋转粘贴）"""
    rx, ry = S * rx_ratio, S * ry_ratio
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=CYAN, width=width)
    layer = layer.rotate(angle_deg, resample=Image.BICUBIC, center=(cx, cy))
    base.alpha_composite(layer)

orbit(-30)
orbit(55)

d = ImageDraw.Draw(base)

def pt_on_orbit(angle_deg, t, rx_ratio=0.42, ry_ratio=0.19):
    """椭圆参数点 t∈[0,2π) 旋转 angle_deg 后的画布坐标"""
    rx, ry = S * rx_ratio, S * ry_ratio
    a = math.radians(angle_deg)
    x0, y0 = rx * math.cos(t), ry * math.sin(t)
    x = cx + x0 * math.cos(a) - y0 * math.sin(a)
    y = cy + x0 * math.sin(a) + y0 * math.cos(a)
    return x, y

# 中心原子核
nr = S * 0.062
d.ellipse([cx - nr, cy - nr, cx + nr, cy + nr], fill=CYAN)

# 三个电子（压在轨道上：左下、右上、右下）
er = S * 0.044
for ang, t in [(-30, 0.55), (55, math.pi + 0.45), (-30, math.pi - 0.55)]:
    x, y = pt_on_orbit(ang, t)
    d.ellipse([x - er, y - er, x + er, y + er], fill=CYAN)

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')
os.makedirs(out_dir, exist_ok=True)

icon512 = base.resize((512, 512), Image.LANCZOS)
icon512.save(os.path.join(out_dir, 'icon.png'))
icon256 = base.resize((256, 256), Image.LANCZOS)
icon256.save(os.path.join(out_dir, 'icon-256.png'))

# 多尺寸 ico（含 16/24/32/48/64/128/256）
base.save(
    os.path.join(out_dir, 'icon.ico'),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print('OK ->', os.path.abspath(out_dir))
for f in ['icon.png', 'icon-256.png', 'icon.ico']:
    p = os.path.join(out_dir, f)
    print(' ', f, os.path.getsize(p), 'bytes')
