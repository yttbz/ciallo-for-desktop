#!/usr/bin/env python3
"""
CialloForDesktop - 图标生成工具

用 Pillow 生成真正的 PNG 图标和多页 ICO 文件。
支持 WebP 输入（自动转换），输出带透明度通道的 PNG。
"""

import struct
import io
import os
import sys
from PIL import Image

# 配置
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD_DIR = os.path.join(ROOT_DIR, 'build')
ASSETS_DIR = os.path.join(ROOT_DIR, 'assets')

# 需要生成的图标尺寸 (宽度, 高度)
ICON_SIZES = [16, 32, 64, 128, 256]

# ICO 文件需要的尺寸 (Windows 标准)
ICO_SIZES = [16, 32, 48, 256]

# 源图标文件路径
SOURCE_ICON = os.path.join(BUILD_DIR, 'tray-icon.png')


def create_ico(png_sizes):
    """
    手动创建 ICO 文件（因为 PIL 的 ICO 支持在旧版本中不完善）

    ICO 文件格式:
    - 6 字节头: reserved(2) + type(2) + count(2)
    - N × 16 字节目录项
    - N 个图像数据 (PNG)
    """
    count = len(png_sizes)

    # 构建头部
    header = struct.pack('<HHH', 0, 1, count)  # reserved=0, type=1(ICO), count

    # 构建目录项和图像数据
    data_offset = 6 + count * 16
    entries = []
    all_data = b''

    for (width, height), png_data in png_sizes:
        # Windows 图标目录项
        w = 0 if width == 256 else width
        h = 0 if height == 256 else height
        entry = struct.pack(
            '<BBBBHHII',
            w,              # 宽度 (0=256)
            h,              # 高度 (0=256)
            0,              # 颜色数
            0,              # 保留
            1,              # 颜色平面
            32,             # 位深
            len(png_data),  # 图像数据大小
            data_offset     # 数据偏移
        )
        entries.append(entry)
        all_data += png_data
        data_offset += len(png_data)

    return header + b''.join(entries) + all_data


def load_source_icon():
    """加载源图标，支持 PNG 和 WebP 格式"""
    if not os.path.exists(SOURCE_ICON):
        print(f"! 源图标文件不存在: {SOURCE_ICON}")
        print("  请先准备一个源图标文件")
        return None

    try:
        img = Image.open(SOURCE_ICON)
        print(f"✓ 加载源图标: {img.size[0]}x{img.size[1]}, mode={img.mode}, format={img.format}")
        return img
    except Exception as e:
        print(f"✗ 无法加载源图标: {e}")
        return None


def ensure_rgba(img):
    """确保图像是 RGBA 模式"""
    if img.mode == 'RGBA':
        return img
    elif img.mode == 'RGB':
        # RGB → RGBA，添加白色背景
        rgba = Image.new('RGBA', img.size, (255, 255, 255, 255))
        rgba.paste(img, (0, 0))
        return rgba
    elif img.mode == 'P' or img.mode == 'PA':
        return img.convert('RGBA')
    else:
        return img.convert('RGBA')


def resize_image(img, size, high_quality=True):
    """缩放到指定尺寸，保持方形"""
    if img.width == img.height == size:
        return img

    if high_quality:
        resample = Image.LANCZOS
    else:
        resample = Image.BILINEAR

    return img.resize((size, size), resample)


def save_png(img, path):
    """保存为真正的 PNG 文件"""
    img.save(path, 'PNG', optimize=True)
    size = os.path.getsize(path)
    print(f"  ✓ 生成 {path} ({img.size[0]}x{img.size[1]}, {size/1024:.1f} KB)")
    return True


def generate_icons():
    """主生成流程"""
    print("=== CialloForDesktop 图标生成工具 ===\n")

    # 确保目录存在
    for d in [BUILD_DIR, ASSETS_DIR]:
        os.makedirs(d, exist_ok=True)

    # 加载源图标
    source = load_source_icon()
    if source is None:
        return False

    # 转为 RGBA
    img = ensure_rgba(source)
    print(f"✓ 转换为 RGBA 模式")

    # 生成各尺寸 PNG
    print(f"\n--- 生成 PNG 图标 ---")

    png_files = {}
    for size in ICON_SIZES:
        resized = resize_image(img, size)
        name = f'icon-{size}.png'
        path = os.path.join(BUILD_DIR, name)
        save_png(resized, path)
        png_files[size] = resized

    # 生成默认 icon.png (256x256)
    icon_256_path = os.path.join(BUILD_DIR, 'icon.png')
    if 256 in png_files:
        save_png(png_files[256], icon_256_path)

    # 生成 assets/app-icon.png (256x256，用于托盘和打包)
    app_icon_path = os.path.join(ASSETS_DIR, 'app-icon.png')
    save_png(png_files.get(256, img), app_icon_path)

    # 生成 tray-icon.png (64x64，托盘图标)
    tray_icon_path = os.path.join(BUILD_DIR, 'tray-icon.png')
    save_png(png_files.get(64, resize_image(img, 64)), tray_icon_path)

    # 生成 ICO 文件
    print(f"\n--- 生成 ICO 图标 ---")
    ico_pngs = []
    for size in ICO_SIZES:
        resized = resize_image(img, size)
        buf = io.BytesIO()
        resized.save(buf, 'PNG', optimize=True)
        ico_pngs.append(((size, size), buf.getvalue()))
        print(f"  ✓ 准备 ICO 页: {size}x{size}")

    ico_data = create_ico(ico_pngs)
    ico_path = os.path.join(BUILD_DIR, 'icon.ico')
    with open(ico_path, 'wb') as f:
        f.write(ico_data)
    print(f"  ✓ 生成 {ico_path} ({len(ico_data)/1024:.1f} KB, {len(ICO_SIZES)} 页)")

    print(f"\n=== 全部完成！===")
    return True


if __name__ == '__main__':
    success = generate_icons()
    sys.exit(0 if success else 1)
