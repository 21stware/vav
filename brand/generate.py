"""Derive the shipped brand assets from brand/logo-2.png.

Run by hand after the logo changes — this is a design-time tool, not part of
the build:

    python3 -m pip install Pillow
    python3 brand/generate.py

The source art is dark ink on white paper. Naively keying out the white would
also eat the periwinkle accent strokes, which are light enough that their
luminance reads as "mostly paper". So each pixel is instead classified by hue
into one of the two brand colours, redrawn in that pure colour, and given an
alpha recovered from how far it sits between the paper and that colour. Edges
then composite cleanly onto any background, which is what lets the same
artwork be recoloured for the dark theme without a halo.
"""

import colorsys
import math
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'logo.png')
ASSETS = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets')
BUILD = os.path.join(ROOT, 'build')
DOCS = os.path.join(ROOT, 'docs')

INK = (0x13, 0x1B, 0x35)
LAVENDER = (0xB2, 0xA5, 0xDC)
# The dark theme is a neutral grey ramp, so the mark's own ink has to lose
# its blue cast too — anything cooler reads as a stain against the surface it
# sits on. The accent keeps its chroma; on dark it is the only colour on screen.
INK_ON_DARK = (0xEF, 0xEF, 0xF1)
LAVENDER_ON_DARK = (0xB7, 0xAA, 0xF3)

PAPER_LUM = 255.0
# Above this luminance a pixel is paper; below it, ink of some opacity.
PAPER_CUTOFF = 252.0
# Hue (degrees) separating the ink strokes from the accent strokes.
HUE_SPLIT = 242.0
# The accent is light by nature, so hue alone would misread dark antialiasing.
ACCENT_MIN_LUM = 120.0

# Square mark — export larger so empty-state / About can show a hero size
# without upscaling a soft JPEG-derived PNG.
MARK_HEIGHT = 192
README_HEIGHT = 160
ICON_SIZE = 1024
ICON_INSET = 100              # macOS reserves ~10% around the 824pt plate
# Windows draws the icon straight onto the taskbar with no plate of its own, so
# it gets the full square and only the corner rounding the shell expects.
ICON_WIN_SIZES = (16, 24, 32, 48, 64, 128, 256)
# macOS plates are superellipses, not circular-arc rounded rects: the curvature
# is continuous, so the corner starts bending much earlier and never shows the
# tangent seam that gives `rounded_rectangle` its dated look.
ICON_SQUIRCLE_N = 5.0
ICON_SUPERSAMPLE = 4
# Square mark reads small on the plate — fill most of the safe area.
ICON_MARK_WIDTH = 0.88
# Menu-bar glyph is ~22pt tall and keeps the wordmark aspect (not crushed into
# a square — that is what made Retina look low-res). 1x/2x/3x at DPI 72/144/216.
TRAY_HEIGHT = 22
TRAY_SCALES = (1, 2, 3)


def luminance(pixel):
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]


def hue_degrees(pixel):
    r, g, b = (c / 255 for c in pixel)
    return colorsys.rgb_to_hsv(r, g, b)[0] * 360


def redraw(source, ink, accent):
    """Repaint the artwork in two pure colours with a recovered alpha channel."""
    width, height = source.size
    src = source.load()
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    dst = out.load()
    ink_lum = luminance(INK)
    accent_lum = luminance(LAVENDER)

    for y in range(height):
        for x in range(width):
            pixel = src[x, y]
            lum = luminance(pixel)
            if lum > PAPER_CUTOFF:
                continue
            is_accent = hue_degrees(pixel) > HUE_SPLIT and lum > ACCENT_MIN_LUM
            colour = accent if is_accent else ink
            pure_lum = accent_lum if is_accent else ink_lum
            alpha = (PAPER_LUM - lum) / max(1.0, PAPER_LUM - pure_lum)
            dst[x, y] = colour + (min(255, int(round(alpha * 255))),)
    return out


def squircle_mask(side, exponent=ICON_SQUIRCLE_N, supersample=ICON_SUPERSAMPLE):
    """An alpha mask for |x|^n + |y|^n = 1, drawn oversized then downsampled."""
    hi = side * supersample
    radius = hi / 2
    steps = 2048
    outline = []
    for index in range(steps):
        angle = 2 * math.pi * index / steps
        cos_t, sin_t = math.cos(angle), math.sin(angle)
        x = radius * math.copysign(abs(cos_t) ** (2.0 / exponent), cos_t)
        y = radius * math.copysign(abs(sin_t) ** (2.0 / exponent), sin_t)
        outline.append((radius + x, radius + y))

    mask = Image.new('L', (hi, hi), 0)
    ImageDraw.Draw(mask).polygon(outline, fill=255)
    return mask.resize((side, side), Image.LANCZOS)


def scaled(art, height):
    scale = height / art.size[1]
    return art.resize((max(1, round(art.size[0] * scale)), height), Image.LANCZOS)


def plated(mark, inset):
    """The mark centred on a paper-white squircle, the way both shells want it."""
    plate = Image.new('RGBA', (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    side = ICON_SIZE - 2 * inset
    face = Image.new('RGBA', (side, side), (0xFA, 0xFA, 0xFE, 255))
    face.putalpha(squircle_mask(side))
    plate.alpha_composite(face, (inset, inset))

    target = int(side * ICON_MARK_WIDTH)
    art = mark.resize((target, max(1, round(mark.size[1] * target / mark.size[0]))), Image.LANCZOS)
    plate.alpha_composite(art, ((ICON_SIZE - art.size[0]) // 2, (ICON_SIZE - art.size[1]) // 2))
    return plate


def tray_size_for_mark(mark):
    """1x pixel size: height fixed, width follows the wordmark aspect."""
    aspect = mark.size[0] / max(1, mark.size[1])
    height = TRAY_HEIGHT
    width = max(height, round(height * aspect))
    return width, height


def tray_template(mark, width, height):
    """Render one tray scale straight from the source mark (not upscaled 1x).

    Each of 1x/2x/3x is drawn into an 8× supersampled canvas then LANCZOS
    down — Retina gets real pixels, not a NEAREST blow-up of the 22pt tile.
    """
    from PIL import ImageFilter

    hi_w = width * 8
    hi_h = height * 8
    alpha = mark.split()[3]
    fit_h = int(hi_h * 0.9)
    scale = fit_h / alpha.size[1]
    art_w = max(1, round(alpha.size[0] * scale))
    art_h = max(1, round(alpha.size[1] * scale))
    work = alpha.resize((art_w, art_h), Image.LANCZOS)

    # Thicken ~0.6–0.8px of the destination size, in supersample space.
    dilate = 5 if height <= TRAY_HEIGHT else (7 if height <= TRAY_HEIGHT * 2 else 9)
    work = work.filter(ImageFilter.MaxFilter(dilate))
    work = work.filter(ImageFilter.GaussianBlur(0.35))

    canvas = Image.new('L', (hi_w, hi_h), 0)
    canvas.paste(work, ((hi_w - art_w) // 2, (hi_h - art_h) // 2))
    gray = canvas.resize((width, height), Image.LANCZOS)

    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    px, g = out.load(), gray.load()
    for y in range(height):
        for x in range(width):
            value = g[x, y]
            # Keep a short AA ramp; crush the muddy mid-greys that read as blur.
            if value < 28:
                continue
            if value > 200:
                alpha_v = 255
            else:
                alpha_v = min(255, int(40 + (value - 28) * (215 / 172)))
            px[x, y] = (0, 0, 0, alpha_v)
    return out


def tray_filename(scale):
    return 'trayTemplate.png' if scale == 1 else f'trayTemplate@{scale}x.png'


def save_tray_png(image, path, dpi):
    """Write PNG with DPI; open-by-handle so `@2x` filenames do not confuse Pillow."""
    with open(path, 'wb') as handle:
        image.save(handle, format='PNG', dpi=(dpi, dpi))


def main():
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(DOCS, exist_ok=True)

    source = Image.open(SRC).convert('RGB')
    bbox = redraw(source, INK, LAVENDER).getbbox()
    padded = (bbox[0] - 6, bbox[1] - 6, bbox[2] + 6, bbox[3] + 6)

    for name, ink, accent in (
        ('wordmark', INK, LAVENDER),
        ('wordmark-dark', INK_ON_DARK, LAVENDER_ON_DARK),
    ):
        art = redraw(source, ink, accent).crop(padded)
        in_app = scaled(art, MARK_HEIGHT)
        in_app.save(os.path.join(ASSETS, f'{name}.png'))
        print(f'{name}.png {in_app.size[0]}x{in_app.size[1]}')

        # GitHub has no CSS of ours to switch on, so the README picks between
        # these two with a <picture> media query instead.
        banner = scaled(art, README_HEIGHT)
        banner.save(os.path.join(DOCS, f'{name}.png'))
        print(f'docs/{name}.png {banner.size[0]}x{banner.size[1]}')

    mark = redraw(source, INK, LAVENDER).crop(bbox)

    plated(mark, ICON_INSET).save(os.path.join(BUILD, 'icon.png'))
    print(f'icon.png {ICON_SIZE}x{ICON_SIZE}')

    # Windows scales the icon down to 16px for the taskbar, where macOS's plate
    # margin would leave the mark a few pixels wide. It gets the tighter plate.
    plated(mark, ICON_SIZE // 32).save(
        os.path.join(BUILD, 'icon.ico'),
        sizes=[(size, size) for size in ICON_WIN_SIZES],
    )
    print(f'icon.ico {"/".join(str(size) for size in ICON_WIN_SIZES)}')

    width_1x, height_1x = tray_size_for_mark(mark)
    for scale in TRAY_SCALES:
        width, height = width_1x * scale, height_1x * scale
        tray = tray_template(mark, width, height)
        name = tray_filename(scale)
        path = os.path.join(BUILD, name)
        save_tray_png(tray, path, dpi=72 * scale)
        # Belt-and-braces: sips DPI metadata is what AppKit/Electron docs ask for.
        try:
            import subprocess

            subprocess.run(
                [
                    'sips',
                    '-s',
                    'dpiWidth',
                    str(72 * scale),
                    '-s',
                    'dpiHeight',
                    str(72 * scale),
                    path,
                ],
                check=False,
                capture_output=True,
            )
        except OSError:
            pass
        print(f'{name} {width}x{height} @ {72 * scale}dpi')


if __name__ == '__main__':
    main()
