"""Extract equal-spaced frames from brand/loading-3.mp4 for the stream status mark.

Design-time tool (not part of the build):

    python3 brand/extract-loading.py

Samples ~6 midpoints across the clip, drops chroma, keys out the paper so the
ink is black-on-transparent (mask-friendly), and writes:

  brand/loading-frames/   — 128px previews
  src/renderer/src/assets/loading/ — 48px frames, done.png, sprite.png
"""

from __future__ import annotations

import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'loading-3.mp4')
BRAND_OUT = os.path.join(ROOT, 'brand', 'loading-frames')
ASSET_OUT = os.path.join(ROOT, 'src', 'renderer', 'src', 'assets', 'loading')

FRAME_COUNT = 6
PAPER_CUTOFF = 248.0
EXPORT_SIZE = 48
PREVIEW_SIZE = 128
PAD = 12


def video_duration(path: str) -> float:
    out = subprocess.check_output(
        [
            'ffprobe',
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=duration',
            '-of',
            'default=noprint_wrappers=1:nokey=1',
            path,
        ],
        text=True,
    ).strip()
    return float(out)


def extract_raw(path: str, t: float, dest: str) -> None:
    subprocess.run(
        [
            'ffmpeg',
            '-y',
            '-ss',
            f'{t:.4f}',
            '-i',
            path,
            '-frames:v',
            '1',
            dest,
        ],
        check=True,
        capture_output=True,
    )


def to_ink_alpha(im: Image.Image) -> Image.Image:
    """Grayscale ink on transparent paper — no hue left."""
    im = im.convert('RGBA')
    width, height = im.size
    src = im.load()
    out = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    dst = out.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _a = src[x, y]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if lum >= PAPER_CUTOFF:
                continue
            ink = max(0.0, min(1.0, (PAPER_CUTOFF - lum) / PAPER_CUTOFF))
            # Lift mid-tones so lavender whiskers survive as soft gray ink.
            alpha = int(round(ink**0.85 * 255))
            if alpha < 2:
                continue
            dst[x, y] = (0, 0, 0, alpha)
    return out


def tight_square(im: Image.Image, pad: int = PAD) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad)
    y1 = min(im.height, y1 + pad)
    side = max(x1 - x0, y1 - y0)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    x0 = int(max(0, cx - side / 2))
    y0 = int(max(0, cy - side / 2))
    x1 = min(im.width, x0 + side)
    y1 = min(im.height, y0 + side)
    x0 = max(0, x1 - side)
    y0 = max(0, y1 - side)
    return im.crop((x0, y0, x0 + side, y0 + side))


def main() -> int:
    if not os.path.isfile(SRC):
        print(f'missing {SRC}', file=sys.stderr)
        return 1

    os.makedirs(BRAND_OUT, exist_ok=True)
    os.makedirs(ASSET_OUT, exist_ok=True)

    duration = video_duration(SRC)
    times = [(i + 0.5) * duration / FRAME_COUNT for i in range(FRAME_COUNT)]
    print(f'duration={duration:.3f}s samples={[round(t, 3) for t in times]}')

    frames: list[Image.Image] = []
    tmp = os.path.join(BRAND_OUT, '.raw.png')
    for i, t in enumerate(times):
        extract_raw(SRC, t, tmp)
        ink = tight_square(to_ink_alpha(Image.open(tmp)))
        preview = ink.resize((PREVIEW_SIZE, PREVIEW_SIZE), Image.Resampling.LANCZOS)
        small = ink.resize((EXPORT_SIZE, EXPORT_SIZE), Image.Resampling.LANCZOS)
        preview.save(os.path.join(BRAND_OUT, f'frame-{i}.png'))
        small.save(os.path.join(ASSET_OUT, f'frame-{i}.png'))
        frames.append(small)
        print(f'frame-{i}.png')

    os.remove(tmp)

    # Settled pose (last sample) for Done.
    frames[-1].save(os.path.join(ASSET_OUT, 'done.png'))
    frames[-1].resize((PREVIEW_SIZE, PREVIEW_SIZE), Image.Resampling.LANCZOS).save(
        os.path.join(BRAND_OUT, 'done.png')
    )

    sprite = Image.new('RGBA', (EXPORT_SIZE * FRAME_COUNT, EXPORT_SIZE), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        sprite.paste(fr, (i * EXPORT_SIZE, 0), fr)
    sprite.save(os.path.join(ASSET_OUT, 'sprite.png'))
    print(f'sprite.png {sprite.size[0]}x{sprite.size[1]}')
    print(f'done.png → assets + brand preview')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
