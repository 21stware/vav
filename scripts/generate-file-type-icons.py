#!/usr/bin/env python3
"""Document icons for every format VAV can claim as a default opener.

Finder / Explorer fall back to the app tile when a document type has no
CFBundleTypeIconFile / ProgId icon — which is why every bound file used to
look like the cat mark. This script paints a family of portrait plates:
same shape and type, unique hue + badge.

    python3 scripts/generate-file-type-icons.py

Writes:

    build/file-icons/{id}.png    1024 master
    build/file-icons/{id}.icns   macOS (via iconutil)
    build/file-icons/{id}.ico    Windows
    build/file-icons/preview.png contact sheet (not shipped)
    build/file-icons/manifest.json
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'build', 'file-icons')
FORMATS_TS = os.path.join(ROOT, 'src', 'shared', 'fileAssociationFormats.ts')
MARK_SRC = os.path.join(ROOT, 'build', 'icon.png')

MASTER = 1024
WIN_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICNS_SIZES = (
    (16, 'icon_16x16.png'),
    (32, 'icon_16x16@2x.png'),
    (32, 'icon_32x32.png'),
    (64, 'icon_32x32@2x.png'),
    (128, 'icon_128x128.png'),
    (256, 'icon_128x128@2x.png'),
    (256, 'icon_256x256.png'),
    (512, 'icon_512x512@2x.png'),
    (512, 'icon_512x512.png'),
    (1024, 'icon_512x512@2x.png'),
)

# (path, ttc index). Monospace for the extension badge.
FONT_CANDIDATES = (
    ('/System/Library/Fonts/Menlo.ttc', 1),
    ('/System/Library/Fonts/SFNSMono.ttf', 0),
    ('/System/Library/Fonts/Menlo.ttc', 0),
    ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 0),
)


def parse_formats(path: str) -> list[dict]:
    """Read id/label/extensions/uti/tier/badge/color from the TS catalog."""
    text = open(path, encoding='utf-8').read()
    start = text.find('export const FILE_ASSOCIATION_FORMATS')
    if start < 0:
        raise SystemExit(f'FILE_ASSOCIATION_FORMATS not found in {path}')
    body = text[start:]
    formats: list[dict] = []
    current: dict | None = None
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith('{') and current is None:
            current = {}
            continue
        if current is None:
            continue
        if line.startswith('}'):
            if not all(k in current for k in ('id', 'label', 'badge', 'color', 'uti', 'extensions')):
                raise SystemExit(f'incomplete format: {current}')
            formats.append(current)
            current = None
            if line.startswith('}]') or line == ']':
                break
            continue
        if ':' not in line:
            continue
        key, _, rest = line.partition(':')
        key = key.strip()
        rest = rest.strip().rstrip(',')
        if key == 'extensions':
            current[key] = [part.strip().strip("'\"") for part in rest.strip('[]').split(',') if part.strip()]
        elif key in ('id', 'label', 'uti', 'tier', 'badge', 'color'):
            current[key] = rest.strip("'\"")
    if not formats:
        raise SystemExit(f'no formats parsed from {path}')
    return formats


def load_font(px: int) -> ImageFont.FreeTypeFont:
    for path, index in FONT_CANDIDATES:
        if not os.path.isfile(path):
            continue
        try:
            return ImageFont.truetype(path, px, index=index)
        except OSError:
            continue
    return ImageFont.load_default()


_mark_stencil: Image.Image | None = None


def load_mark_stencil() -> Image.Image:
    """Cat ink from the brand mark — cream plate discarded, strokes only."""
    global _mark_stencil
    if _mark_stencil is not None:
        return _mark_stencil
    if not os.path.isfile(MARK_SRC):
        raise SystemExit(f'missing brand mark {MARK_SRC}')
    src = Image.open(MARK_SRC).convert('RGBA')
    gray = src.convert('L')
    # Ink is near-black; the cream tile is ~245 and must not stamp.
    ink = ImageChops.multiply(
        gray.point(lambda p: 255 if p < 90 else 0),
        src.getchannel('A'),
    )
    box = ink.getbbox()
    if not box:
        raise SystemExit(f'no ink found in {MARK_SRC}')
    _mark_stencil = ink.crop(box)
    return _mark_stencil


def paint_mark(plate: Image.Image, page_mask: Image.Image) -> Image.Image:
    """Pale-white cat, oversized so only ~3/4 sits on the page (clipped seal)."""
    stencil = load_mark_stencil()
    page_w, page_h = plate.size
    sw, sh = stencil.size
    # 1 / 0.75 ≈ 1.33× the page, so about a quarter of the mark hangs off.
    tw = max(1, round(page_w / 0.75))
    th = max(1, round(sh * (tw / sw)))
    if th < page_h / 0.75:
        th = max(1, round(page_h / 0.75))
        tw = max(1, round(sw * (th / sh)))
    mark = stencil.resize((tw, th), Image.Resampling.LANCZOS)
    tint = Image.new('RGBA', (tw, th), (255, 255, 255, 0))
    tint.putalpha(mark.point(lambda p: round(p * 0.50)))
    layer = Image.new('RGBA', plate.size, (0, 0, 0, 0))
    mx = (page_w - tw) // 2
    my = (page_h - th) // 2 - round(page_h * 0.06)
    layer.paste(tint, (mx, my), tint)
    layer.putalpha(ImageChops.multiply(layer.getchannel('A'), page_mask))
    return Image.alpha_composite(plate, layer)


def hex_rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip('#')
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def document_mask(size: tuple[int, int], radius: int) -> Image.Image:
    """Portrait page — circular corners, no diagonal cut."""
    w, h = size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    return mask


def render_plate(spec: dict, size: int) -> Image.Image:
    """Paint one document at `size`, supersampled then downscaled."""
    ss = 4 if size <= 128 else 2
    canvas = size * ss
    image = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))

    inset = round(canvas * (0.10 if size >= 32 else 0.05))
    page_h = canvas - inset * 2
    page_w = round(page_h * (0.74 if size >= 24 else 0.80))
    left = (canvas - page_w) // 2
    top = (canvas - page_h) // 2
    radius = max(2 * ss, round(page_w * 0.16))
    color = hex_rgb(spec['color'])

    if size >= 24:
        shadow = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        lift = max(ss, round(canvas * 0.014))
        shadow_draw.rounded_rectangle(
            (left, top + lift, left + page_w, top + page_h + lift),
            radius=radius,
            fill=(0, 0, 0, 72 if size >= 64 else 56),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(ss, round(canvas * 0.016))))
        image = Image.alpha_composite(image, shadow)

    plate = Image.new('RGBA', (page_w, page_h), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rectangle((0, 0, page_w, page_h), fill=(*color, 255))
    mask = document_mask((page_w, page_h), radius)
    plate.putalpha(ImageChops.multiply(plate.getchannel('A'), mask))

    badge = spec['badge']
    show_badge = size >= 24
    badge_band = round(page_h * (0.34 if show_badge else 0.08))
    plate = paint_mark(plate, mask)
    image.alpha_composite(plate, (left, top))

    if show_badge:
        max_w = page_w * (0.90 if len(badge) <= 3 else 0.94)
        font_px = round(page_w * (0.36 if len(badge) == 2 else 0.28 if len(badge) == 3 else 0.22))
        font = load_font(font_px)
        draw = ImageDraw.Draw(image)
        bbox = draw.textbbox((0, 0), badge, font=font)
        text_w = bbox[2] - bbox[0]
        if text_w > max_w:
            font = load_font(max(8, int(font_px * max_w / text_w)))
            bbox = draw.textbbox((0, 0), badge, font=font)
            text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        x = left + (page_w - text_w) / 2 - bbox[0]
        y = top + page_h - badge_band + (badge_band - text_h) / 2 - bbox[1] - page_h * 0.01
        draw.text((x, y), badge, font=font, fill=(255, 255, 255, 255))

    if canvas != size:
        image = image.resize((size, size), Image.Resampling.LANCZOS)
    return image


def save_ico(master: Image.Image, spec: dict, dest: str) -> None:
    frames = [render_plate(spec, size) for size in WIN_SIZES]
    frames[-1].save(dest, format='ICO', sizes=[(s, s) for s in WIN_SIZES], append_images=frames[:-1])


def save_icns(spec: dict, dest: str) -> None:
    if shutil.which('iconutil') is None:
        print(f'warn: iconutil missing — skipped {os.path.basename(dest)}', file=sys.stderr)
        return
    scratch = tempfile.mkdtemp(prefix=f"vav-{spec['id']}-")
    iconset = os.path.join(scratch, f"{spec['id']}.iconset")
    os.makedirs(iconset)
    try:
        for size, name in ICNS_SIZES:
            render_plate(spec, size).save(os.path.join(iconset, name), format='PNG')
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', dest], check=True, capture_output=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def save_preview(masters: list[tuple[dict, Image.Image]], dest: str) -> None:
    cell = 220
    pad = 24
    cols = 4
    rows = (len(masters) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cell + pad * 2, rows * cell + pad * 2 + 36), (246, 244, 240, 255))
    draw = ImageDraw.Draw(sheet)
    label_font = load_font(18)
    thumb = 128
    for i, (spec, master) in enumerate(masters):
        c, r = i % cols, i // cols
        x = pad + c * cell + (cell - thumb) // 2
        y = pad + r * cell
        sheet.alpha_composite(master.resize((thumb, thumb), Image.Resampling.LANCZOS), (x, y))
        label = spec['badge']
        bbox = draw.textbbox((0, 0), label, font=label_font)
        lx = pad + c * cell + (cell - (bbox[2] - bbox[0])) // 2
        draw.text((lx, y + thumb + 8), label, font=label_font, fill=(40, 40, 46, 220))
    sheet.save(dest, format='PNG', optimize=True)


def main() -> None:
    formats = parse_formats(FORMATS_TS)
    os.makedirs(OUT, exist_ok=True)
    masters: list[tuple[dict, Image.Image]] = []
    for spec in formats:
        master = render_plate(spec, MASTER)
        png = os.path.join(OUT, f"{spec['id']}.png")
        master.save(png, format='PNG', optimize=True)
        save_ico(master, spec, os.path.join(OUT, f"{spec['id']}.ico"))
        save_icns(spec, os.path.join(OUT, f"{spec['id']}.icns"))
        masters.append((spec, master))
        print(f"{spec['id']:12} {spec['badge']:4} {spec['color']}")

    save_preview(masters, os.path.join(OUT, 'preview.png'))
    manifest = [
        {
            'id': spec['id'],
            'label': spec['label'],
            'extensions': [ext.lstrip('.') for ext in spec['extensions']],
            'uti': spec['uti'],
            'tier': spec.get('tier', 'p0'),
            'badge': spec['badge'],
            'color': spec['color'],
            'icon': spec['id'],
        }
        for spec in formats
    ]
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as handle:
        json.dump(manifest, handle, indent=2)
        handle.write('\n')
    print(f'done. {len(formats)} icons → {OUT}')


if __name__ == '__main__':
    main()
