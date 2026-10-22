"""Render the export mark from one coordinate set into SVG and Chromium PNG sizes."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets'
PATHS = [[(64, 76), (64, 34)], [(47, 51), (64, 34), (81, 51)], [(36, 71), (36, 94), (92, 94), (92, 71)]]
COLORS = [(0, (0, 191, 255)), (.58, (71, 26, 255)), (1, (149, 0, 255))]


def build():
    OUT.mkdir(exist_ok=True)
    paths = ''.join('<path d="M' + ' L'.join(f'{x} {y}' for x, y in points) + '"/>' for points in PATHS)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="Стрелка экспорта"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#00BFFF"/><stop offset=".58" stop-color="#471AFF"/><stop offset="1" stop-color="#9500FF"/></linearGradient></defs><rect width="128" height="128" rx="32" fill="url(#g)"/><g fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">{paths}</g></svg>'''
    (OUT / 'export.svg').write_text(svg, encoding='utf-8')
    scale = 4
    size = 128 * scale
    image = Image.new('RGBA', (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            left, right = COLORS[:2] if t <= .58 else COLORS[1:]
            ratio = (t - left[0]) / (right[0] - left[0])
            pixels[x, y] = tuple(round(a + (b - a) * ratio) for a, b in zip(left[1], right[1])) + (255,)
    mask = Image.new('L', image.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=32 * scale, fill=255)
    image.putalpha(mask)
    draw = ImageDraw.Draw(image)
    for points in PATHS:
        coords = [(x * scale, y * scale) for x, y in points]
        draw.line(coords, fill='white', width=9 * scale, joint='curve')
        for x, y in coords:
            r = 4.5 * scale
            draw.ellipse((x-r, y-r, x+r, y+r), fill='white')
    for output_size in [16, 32, 48, 128]:
        image.resize((output_size, output_size), Image.Resampling.LANCZOS).save(OUT / f'icon-{output_size}.png')
    print('Generated export.svg and PNG icons: 16, 32, 48, 128')


if __name__ == '__main__':
    build()
