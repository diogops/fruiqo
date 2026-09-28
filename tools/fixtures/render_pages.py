"""Renderiza cada fixtures/**/page-N.ocr.txt em page-N.png (print sintético 1080x2400).

A imagem é derivada do texto esperado do OCR, então os dois nunca divergem. Linhas que parecem
interface (curtidas, "Seguir", horários) saem em cinza, como num app de rede social.
Requer Pillow. Uso: python tools/fixtures/render_pages.py
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
W, H = 1080, 2400
UI = re.compile(r"^(\d{1,2}:\d{2}|seguir|curtido por|ver |responder|há \d|comentários)", re.I)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = (
        ["C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold
        else ["C:/Windows/Fonts/segoeui.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for c in candidates:
        if Path(c).exists():
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


def render(txt: Path) -> None:
    lines = txt.read_text(encoding="utf-8").splitlines()
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    regular, small, bold = font(46), font(36), font(48, bold=True)
    y = 40
    for i, line in enumerate(lines):
        if not line.strip():
            y += 40
            continue
        is_ui = bool(UI.match(line.strip()))
        f = small if is_ui else (bold if i < 2 else regular)
        color = (120, 120, 120) if is_ui else (0, 0, 0)
        if line.strip().lower() == "seguir":
            color = (0, 149, 246)
        draw.text((48, y), line, font=f, fill=color)
        y += 70 if is_ui else 96
        if y > H - 120:
            break
    img.save(txt.with_suffix("").with_suffix(".png"))


def main() -> None:
    count = 0
    for txt in sorted(FIXTURES.glob("**/page-*.ocr.txt")):
        render(txt)
        count += 1
    print(f"{count} prints renderizados")


if __name__ == "__main__":
    main()
