#!/usr/bin/env python3
"""Derive Windows .ico + site favicon from the shipped macOS app icons.

Source of truth (do not overwrite these here — they come from Icon Composer /
macOS overlays):

    build/icon.png
    build/icon-dark.png

This script only regenerates the derivatives that drifted in v1.4.0:

    build/icon.ico              — multi-size Windows shell icon (tighter inset)
    site/assets/favicon.png     — 256px plate matching the Dock tile
    src/renderer/public/icon.png
    src/renderer/public/icon-dark.png

macOS keeps ~10% margin so the tile sits correctly in the Dock. Windows draws
the bitmap edge-to-edge in the taskbar / Start menu, so we replate with a much
smaller inset before baking the .ico (see docs/TECH_DESIGN.md).

    python3 scripts/sync-brand-icons.py
"""

from __future__ import annotations

import os
import shutil
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')
SITE = os.path.join(ROOT, 'site', 'assets')
PUBLIC = os.path.join(ROOT, 'src', 'renderer', 'public')
EXT_ICONS = os.path.join(ROOT, 'extension', 'icons')
EXT_ICON_SIZES = (16, 32, 48, 128)

ICON_PNG = os.path.join(BUILD, 'icon.png')
ICON_DARK_PNG = os.path.join(BUILD, 'icon-dark.png')
ICON_ICO = os.path.join(BUILD, 'icon.ico')
FAVICON = os.path.join(SITE, 'favicon.png')

ICON_SIZE = 1024
# macOS plate uses ~100px inset; Windows taskbar needs the mark larger.
WIN_INSET = ICON_SIZE // 32  # 32px
ICON_WIN_SIZES = (16, 24, 32, 48, 64, 128, 256)


def content_bbox(image: Image.Image, alpha_floor: int = 8) -> tuple[int, int, int, int]:
    """Tight bbox of non-transparent pixels."""
    alpha = image.getchannel('A')
    mask = alpha.point(lambda a: 255 if a > alpha_floor else 0)
    box = mask.getbbox()
    if not box:
        raise SystemExit(f'No opaque content in {image.size} image')
    return box


def replate_tighter(icon: Image.Image, inset: int) -> Image.Image:
    """Scale the opaque plate to fill a 1024 canvas with `inset` padding."""
    src = icon.convert('RGBA')
    if src.size != (ICON_SIZE, ICON_SIZE):
        src = src.resize((ICON_SIZE, ICON_SIZE), Image.Resampling.LANCZOS)
    box = content_bbox(src)
    cropped = src.crop(box)
    target = ICON_SIZE - 2 * inset
    fitted = cropped.copy()
    fitted.thumbnail((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    x = (ICON_SIZE - fitted.size[0]) // 2
    y = (ICON_SIZE - fitted.size[1]) // 2
    canvas.alpha_composite(fitted, (x, y))
    return canvas


def save_ico(image: Image.Image, path: str, sizes: tuple[int, ...]) -> None:
    # Pillow writes each size as a separate PNG-compressed frame inside the ICO.
    image.save(path, format='ICO', sizes=[(s, s) for s in sizes])


def main() -> None:
    if not os.path.isfile(ICON_PNG):
        raise SystemExit(f'missing source {ICON_PNG}')

    icon = Image.open(ICON_PNG).convert('RGBA')
    print(f'source build/icon.png {icon.size[0]}x{icon.size[1]}')

    win = replate_tighter(icon, WIN_INSET)
    save_ico(win, ICON_ICO, ICON_WIN_SIZES)
    print(f'build/icon.ico {"/".join(str(s) for s in ICON_WIN_SIZES)} (inset {WIN_INSET}px)')

    os.makedirs(SITE, exist_ok=True)
    favicon = icon.resize((256, 256), Image.Resampling.LANCZOS)
    favicon.save(FAVICON, format='PNG', optimize=True)
    print('site/assets/favicon.png 256x256')

    os.makedirs(EXT_ICONS, exist_ok=True)
    box = content_bbox(icon)
    cropped = icon.crop(box)
    for size in EXT_ICON_SIZES:
        inset = 1 if size <= 32 else max(1, size // 32)
        canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        fitted = cropped.copy()
        fitted.thumbnail((size - 2 * inset, size - 2 * inset), Image.Resampling.LANCZOS)
        x = (size - fitted.size[0]) // 2
        y = (size - fitted.size[1]) // 2
        canvas.alpha_composite(fitted, (x, y))
        canvas.save(os.path.join(EXT_ICONS, f'icon{size}.png'), format='PNG')
    print('extension/icons icon16/32/48/128')

    os.makedirs(PUBLIC, exist_ok=True)
    shutil.copy2(ICON_PNG, os.path.join(PUBLIC, 'icon.png'))
    print('src/renderer/public/icon.png ← build/icon.png')
    if os.path.isfile(ICON_DARK_PNG):
        shutil.copy2(ICON_DARK_PNG, os.path.join(PUBLIC, 'icon-dark.png'))
        print('src/renderer/public/icon-dark.png ← build/icon-dark.png')
    else:
        print('warn: build/icon-dark.png missing — skipped public dark copy', file=sys.stderr)

    print('done.')


if __name__ == '__main__':
    main()
