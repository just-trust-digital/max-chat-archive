"""Render the export mark from one coordinate set into SVG and Chromium PNG sizes."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets'
PATHS = [[(64, 76), (64, 34)], [(47, 51), (64, 34), (81, 51)], [(36, 71), (36, 94), (92, 94), (92, 71)]]
OUTER = [(0, (36, 101, 241)), (1, (120, 0, 238))]
INNER = [(0, (0, 191, 255)), (.58, (71, 26, 255)), (1, (149, 0, 255))]
INSET = 20
TILE = 128 - INSET * 2
TILE_SCALE = TILE / 128


def gradient(size, colors):
    image = Image.new('RGBA', (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            left, right = next((a, b) for a, b in zip(colors, colors[1:]) if a[0] <= t <= b[0])
            ratio = (t - left[0]) / (right[0] - left[0])
            pixels[x, y] = tuple(round(a + (b - a) * ratio) for a, b in zip(left[1], right[1])) + (255,)
    return image


def build():
    OUT.mkdir(exist_ok=True)
    paths = ''.join('<path d="M' + ' L'.join(f'{x} {y}' for x, y in points) + '"/>' for points in PATHS)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Стрелка экспорта"><defs><linearGradient id="outer" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2465F1"/><stop offset="1" stop-color="#7800EE"/></linearGradient><linearGradient id="inner" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#00BFFF"/><stop offset=".58" stop-color="#471AFF"/><stop offset="1" stop-color="#9500FF"/></linearGradient></defs><rect width="128" height="128" rx="32" fill="url(#outer)"/><rect x="{INSET}" y="{INSET}" width="{TILE}" height="{TILE}" rx="24" fill="url(#inner)"/><g transform="translate({INSET} {INSET}) scale({TILE_SCALE})" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">{paths}</g></svg>'''
    (OUT / 'export.svg').write_text(svg, encoding='utf-8')
    scale = 4
    size = 128 * scale
    image = gradient(size, OUTER)
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=32 * scale, fill=255)
    image.putalpha(mask)
    tile_size = TILE * scale
    tile = gradient(tile_size, INNER)
    tile_mask = Image.new('L', tile.size)
    ImageDraw.Draw(tile_mask).rounded_rectangle((0, 0, tile_size - 1, tile_size - 1), radius=24 * scale, fill=255)
    tile.putalpha(tile_mask)
    image.alpha_composite(tile, (INSET * scale, INSET * scale))
    draw = ImageDraw.Draw(image)
    for points in PATHS:
        coords = [((INSET + x * TILE_SCALE) * scale, (INSET + y * TILE_SCALE) * scale) for x, y in points]
        draw.line(coords, fill='white', width=round(9 * TILE_SCALE * scale), joint='curve')
        for x, y in coords:
            r = 4.5 * TILE_SCALE * scale
            draw.ellipse((x-r, y-r, x+r, y+r), fill='white')
    for output_size in [16, 32, 48, 128]:
        image.resize((output_size, output_size), Image.Resampling.LANCZOS).save(OUT / f'icon-{output_size}.png')
    print('Generated export.svg and PNG icons: 16, 32, 48, 128')


if __name__ == '__main__':
    build()
