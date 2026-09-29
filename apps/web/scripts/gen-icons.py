"""Ícones do web instalável (tela de início do iPhone e PWA), a partir da marca do Fruiqo:
degradê azul (--grad-brand) com o triângulo branco de "play". Rodar: python scripts/gen-icons.py
Saída em public/icons (versionada). Requer Pillow."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
STOPS = [(0.0, (0x25, 0x63, 0xEB)), (0.45, (0x3B, 0x82, 0xF6)), (1.1, (0x22, 0xD3, 0xEE))]


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def color_at(t):
    for (p0, c0), (p1, c1) in zip(STOPS, STOPS[1:]):
        if t <= p1:
            return lerp(c0, c1, max(0.0, (t - p0) / (p1 - p0)))
    return STOPS[-1][1]


def icon(size, scale):
    """`scale`: fração do lado ocupada pelo desenho (maskable precisa de margem de segurança)."""
    s = size * 4  # desenha maior e reduz: bordas suaves
    img = Image.new("RGB", (s, s))
    px = img.load()
    for y in range(s):
        for x in range(s):
            px[x, y] = color_at((x + y) / (2 * s))  # 135°
    d = ImageDraw.Draw(img)
    # triângulo do BrandMark (viewBox 24): M8 5.5 v13 l10.5 -6.5, centralizado
    k = s * scale / 24
    ox = (s - 24 * k) / 2 + 0.6 * k  # compensa o centro óptico do triângulo
    oy = (s - 24 * k) / 2
    pts = [(ox + 8 * k, oy + 5.5 * k), (ox + 8 * k, oy + 18.5 * k), (ox + 18.5 * k, oy + 12 * k)]
    d.polygon(pts, fill=(255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
icon(180, 0.78).save(OUT / "apple-touch-icon.png")
icon(192, 0.78).save(OUT / "icon-192.png")
icon(512, 0.78).save(OUT / "icon-512.png")
icon(512, 0.58).save(OUT / "icon-maskable-512.png")
icon(32, 0.9).save(OUT / "favicon-32.png")
print("ícones gerados em", OUT)
