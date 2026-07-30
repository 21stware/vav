"""Derive shipped brand assets from brand/logo.png.

Run after the logo changes (design-time tool, not part of the app build):

    python3 -m pip install Pillow
    python3 brand/generate.py

Source art is the cat-mark app icon: dark navy + lavender strokes on a light
plate. We:

1. Key out the light plate and repaint strokes in pure brand colours with alpha
2. Build macOS/Windows app icons (superellipse plate + mark)
3. Build monochrome multi-resolution menu-bar tray templates (@1x/@2x/@3x)
4. Emit in-app / docs wordmarks and site favicon
"""

from __future__ import annotations

import colorsys
import math
import os
import subprocess
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'logo.png')
ASSETS = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets')
BUILD = os.path.join(ROOT, 'build')
DOCS = os.path.join(ROOT, 'docs')
SITE = os.path.join(ROOT, 'site', 'assets')

# Brand colours (tech design: ink + periwinkle from the mark).
INK = (0x13, 0x1B, 0x35)
LAVENDER = (0xB2, 0xA5, 0xDC)
INK_ON_DARK = (0xEF, 0xEF, 0xF1)
LAVENDER_ON_DARK = (0xB7, 0xAA, 0xF3)

# Plate / paper key — logo plate is ~248; anything brighter is background.
PAPER_CUTOFF = 232.0
# Hue (degrees) separating navy strokes from lavender whiskers.
HUE_SPLIT = 242.0
ACCENT_MIN_LUM = 100.0

MARK_HEIGHT = 192
README_HEIGHT = 160
ICON_SIZE = 1024
ICON_INSET = 100  # macOS ~10% margin around the 824pt plate
ICON_WIN_SIZES = (16, 24, 32, 48, 64, 128, 256)
ICON_SQUIRCLE_N = 5.0
ICON_SUPERSAMPLE = 4
# Square cat mark — fill most of the safe plate.
ICON_MARK_FILL = 0.78

# Menu-bar template: square glyph, black + alpha (AppKit template image).
# macOS status items are ~16–22pt logical; 22pt + real @2x/@3x keeps a detailed
# mark sharp. True vector needs an SVG/PDF source — logo.png is raster, so we
# supersample down from the extracted mark instead of upscaling a tiny tile.
TRAY_HEIGHT = 22
TRAY_SCALES = (1, 2, 3)
# Extra supersample for the tray pipeline (on top of the 8× canvas).
TRAY_SS = 8
FAVICON_SIZES = (16, 32, 48, 64, 128, 256)


def luminance(pixel: tuple[int, int, int]) -> float:
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]


def hue_degrees(pixel: tuple[int, int, int]) -> float:
    r, g, b = (c / 255 for c in pixel[:3])
    return colorsys.rgb_to_hsv(r, g, b)[0] * 360


def redraw(source: Image.Image, ink: tuple[int, int, int], accent: tuple[int, int, int]) -> Image.Image:
    """Repaint strokes in two pure colours with recovered alpha; plate → transparent."""
    width, height = source.size
    src = source.convert('RGBA').load()
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    dst = out.load()
    ink_lum = luminance(INK)
    accent_lum = luminance(LAVENDER)

    for y in range(height):
        for x in range(width):
            r, g, b, a = src[x, y]
            if a < 8:
                continue
            pixel = (r, g, b)
            lum = luminance(pixel)
            if lum > PAPER_CUTOFF:
                continue
            # Near-white with low chroma is still plate AA.
            h, s, _v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if lum > 210 and s < 0.08:
                continue
            is_accent = hue_degrees(pixel) > HUE_SPLIT and lum > ACCENT_MIN_LUM
            colour = accent if is_accent else ink
            pure_lum = accent_lum if is_accent else ink_lum
            alpha = (255.0 - lum) / max(1.0, 255.0 - pure_lum)
            alpha = min(1.0, max(0.0, alpha)) * (a / 255.0)
            dst[x, y] = colour + (min(255, int(round(alpha * 255))),)
    return out


def squircle_mask(side: int, exponent: float = ICON_SQUIRCLE_N, supersample: int = ICON_SUPERSAMPLE) -> Image.Image:
    hi = side * supersample
    radius = hi / 2
    steps = 2048
    outline: list[tuple[float, float]] = []
    for index in range(steps):
        angle = 2 * math.pi * index / steps
        cos_t, sin_t = math.cos(angle), math.sin(angle)
        x = radius * math.copysign(abs(cos_t) ** (2.0 / exponent), cos_t)
        y = radius * math.copysign(abs(sin_t) ** (2.0 / exponent), sin_t)
        outline.append((radius + x, radius + y))

    mask = Image.new('L', (hi, hi), 0)
    ImageDraw.Draw(mask).polygon(outline, fill=255)
    return mask.resize((side, side), Image.LANCZOS)


def scaled(art: Image.Image, height: int) -> Image.Image:
    scale = height / art.size[1]
    return art.resize((max(1, round(art.size[0] * scale)), height), Image.LANCZOS)


def fit_contain(art: Image.Image, box: int) -> Image.Image:
    """Scale art to fit inside a square box, preserving aspect."""
    w, h = art.size
    scale = min(box / w, box / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    return art.resize((nw, nh), Image.LANCZOS)


def plated(mark: Image.Image, inset: int) -> Image.Image:
    """Mark centred on a paper-white superellipse (macOS / Dock plate)."""
    plate = Image.new('RGBA', (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    side = ICON_SIZE - 2 * inset
    face = Image.new('RGBA', (side, side), (0xFA, 0xFA, 0xFE, 255))
    face.putalpha(squircle_mask(side))
    plate.alpha_composite(face, (inset, inset))

    art = fit_contain(mark, int(side * ICON_MARK_FILL))
    plate.alpha_composite(
        art,
        ((ICON_SIZE - art.size[0]) // 2, (ICON_SIZE - art.size[1]) // 2),
    )
    return plate


def tray_template(mark: Image.Image, size: int) -> Image.Image:
    """Monochrome template (black + alpha) for one tray scale, square canvas.

    Each scale is rendered independently from the full-res mark (never by
    NEAREST-upscaling the 1x tile), then downsampled — that is what Retina needs
    when the source is a PNG mark rather than a PDF/SVG.
    """
    hi = size * TRAY_SS
    alpha = mark.split()[3]
    # Fit mark inside ~86% of the tile (status item clips aggressive padding).
    fit = int(hi * 0.86)
    scale = min(fit / alpha.size[0], fit / alpha.size[1])
    art_w = max(1, round(alpha.size[0] * scale))
    art_h = max(1, round(alpha.size[1] * scale))
    work = alpha.resize((art_w, art_h), Image.LANCZOS)

    # Light thicken so 1x stays legible; less blur on @2x/@3x so edges stay crisp.
    if size <= TRAY_HEIGHT:
        dilate, blur = 5, 0.28
    elif size <= TRAY_HEIGHT * 2:
        dilate, blur = 7, 0.22
    else:
        dilate, blur = 9, 0.18
    work = work.filter(ImageFilter.MaxFilter(dilate))
    if blur > 0:
        work = work.filter(ImageFilter.GaussianBlur(blur))

    canvas = Image.new('L', (hi, hi), 0)
    canvas.paste(work, ((hi - art_w) // 2, (hi - art_h) // 2))
    gray = canvas.resize((size, size), Image.LANCZOS)

    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px, g = out.load(), gray.load()
    for y in range(size):
        for x in range(size):
            value = g[x, y]
            if value < 20:
                continue
            if value > 210:
                alpha_v = 255
            else:
                # Steeper ramp → less muddy mid-grey on Retina.
                alpha_v = min(255, int(32 + (value - 20) * (223 / 190)))
            # Template images must be black with alpha — AppKit tints them.
            px[x, y] = (0, 0, 0, alpha_v)
    return out


def tray_filename(scale: int) -> str:
    return 'trayTemplate.png' if scale == 1 else f'trayTemplate@{scale}x.png'


def save_tray_png(image: Image.Image, path: str, dpi: int) -> None:
    with open(path, 'wb') as handle:
        image.save(handle, format='PNG', dpi=(dpi, dpi))
    try:
        subprocess.run(
            [
                'sips',
                '-s',
                'dpiWidth',
                str(dpi),
                '-s',
                'dpiHeight',
                str(dpi),
                path,
            ],
            check=False,
            capture_output=True,
        )
    except OSError:
        pass


def save_ico(image: Image.Image, path: str, sizes: tuple[int, ...]) -> None:
    image.save(path, format='ICO', sizes=[(s, s) for s in sizes])


def main() -> None:
    for d in (ASSETS, BUILD, DOCS, SITE):
        os.makedirs(d, exist_ok=True)

    source = Image.open(SRC).convert('RGBA')
    # Extract mark on transparent plate.
    mark_full = redraw(source, INK, LAVENDER)
    bbox = mark_full.getbbox()
    if not bbox:
        raise SystemExit('No non-paper content found in brand/logo.png — check PAPER_CUTOFF')
    pad = 8
    padded = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(source.size[0], bbox[2] + pad),
        min(source.size[1], bbox[3] + pad),
    )
    mark = mark_full.crop(padded)
    print(f'mark extracted {mark.size[0]}x{mark.size[1]} from {source.size[0]}x{source.size[1]}')

    # In-app + docs wordmarks (light / dark).
    for name, ink, accent in (
        ('wordmark', INK, LAVENDER),
        ('wordmark-dark', INK_ON_DARK, LAVENDER_ON_DARK),
    ):
        art = redraw(source, ink, accent).crop(padded)
        in_app = scaled(art, MARK_HEIGHT)
        in_app.save(os.path.join(ASSETS, f'{name}.png'))
        print(f'assets/{name}.png {in_app.size[0]}x{in_app.size[1]}')
        banner = scaled(art, README_HEIGHT)
        banner.save(os.path.join(DOCS, f'{name}.png'))
        print(f'docs/{name}.png {banner.size[0]}x{banner.size[1]}')
        # Site mirrors the light wordmark.
        if name == 'wordmark':
            banner.save(os.path.join(SITE, 'wordmark.png'))
        else:
            banner.save(os.path.join(SITE, 'wordmark-dark.png'))

    # App icon (macOS plate).
    icon = plated(mark, ICON_INSET)
    icon_path = os.path.join(BUILD, 'icon.png')
    icon.save(icon_path)
    print(f'build/icon.png {ICON_SIZE}x{ICON_SIZE}')

    # Also drop a clean mark-only PNG for tooling.
    mark.save(os.path.join(BUILD, 'icon-mark.png'))
    print(f'build/icon-mark.png {mark.size[0]}x{mark.size[1]}')

    # Windows .ico — tighter inset so 16px taskbar stays readable.
    win_plate = plated(mark, ICON_SIZE // 32)
    ico_path = os.path.join(BUILD, 'icon.ico')
    save_ico(win_plate, ico_path, ICON_WIN_SIZES)
    print(f'build/icon.ico {"/".join(str(s) for s in ICON_WIN_SIZES)}')

    # Site favicon (multi-size ico-like PNG set as single 32/256 PNG + ico optional).
    fav = fit_contain(mark, 256)
    canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(fav, ((256 - fav.size[0]) // 2, (256 - fav.size[1]) // 2))
    # Prefer full app icon for favicon so it matches Dock.
    favicon = icon.resize((256, 256), Image.LANCZOS)
    favicon.save(os.path.join(SITE, 'favicon.png'))
    print('site/assets/favicon.png 256x256')
    # Always keep renderer public + agent mark in sync (public/icon.png was a
    # stale initial-commit asset and kept resurfacing the old "vav" wordmark).
    public_dir = os.path.join(ROOT, 'src', 'renderer', 'public')
    if os.path.isdir(public_dir):
        icon.save(os.path.join(public_dir, 'icon.png'))
        print('src/renderer/public/icon.png 1024x1024')
    agents_dir = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'agents')
    if os.path.isdir(agents_dir):
        mark.save(os.path.join(agents_dir, 'vav-mark.png'))
        print('src/renderer/src/assets/agents/vav-mark.png')
    # Mirror into renderer build output if present.
    out_renderer = os.path.join(ROOT, 'out', 'renderer')
    if os.path.isdir(out_renderer):
        icon.save(os.path.join(out_renderer, 'icon.png'))

    # Tray templates — monochrome, multi-resolution.
    for scale in TRAY_SCALES:
        size = TRAY_HEIGHT * scale
        tray = tray_template(mark, size)
        name = tray_filename(scale)
        path = os.path.join(BUILD, name)
        save_tray_png(tray, path, dpi=72 * scale)
        print(f'build/{name} {size}x{size} @ {72 * scale}dpi')

    print('done.')


if __name__ == '__main__':
    main()
