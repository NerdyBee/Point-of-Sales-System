"""Product tile images for the demo shop: a soft colour square with a large Windows emoji.

    python scripts/marketing/tiles.py      -> release/marketing/assets/products/<n>.png
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
data = json.loads((root / "scripts/marketing/demo-data.json").read_text(encoding="utf-8"))
out = root / "release/marketing/assets/products"
out.mkdir(parents=True, exist_ok=True)

# Segoe UI Emoji only renders colour glyphs at 109 px; draw there, then scale up.
emoji_font = ImageFont.truetype("C:/Windows/Fonts/seguiemj.ttf", 109)

for index, product in enumerate(data["products"]):
    tile = Image.new("RGB", (600, 600), product["color"])
    glyph = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((80, 80), product["emoji"], font=emoji_font, embedded_color=True, anchor="mm")
    glyph = glyph.resize((420, 420), Image.LANCZOS)
    tile.paste(glyph, (90, 90), glyph)
    tile.save(out / f"{index:02d}.png", optimize=True)

print(f"{len(data['products'])} tiles in {out}")
