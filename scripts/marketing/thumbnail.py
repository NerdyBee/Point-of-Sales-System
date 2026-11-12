"""YouTube thumbnail (1280x720) from the demo screenshots.

    python scripts/marketing/thumbnail.py   -> release/marketing/Ajoke-POS-Demo-thumbnail.png
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

root = Path(__file__).resolve().parents[2]
out = root / "release/marketing"
shots = {shot["id"]: out / "shots" / shot["file"] for shot in json.loads((out / "shots.json").read_text(encoding="utf-8"))["shots"]}

W, H = 1280, 720
NAVY = (7, 2, 53)
ACCENT = (227, 223, 255)
GREEN = (163, 230, 53)
font = lambda name, size: ImageFont.truetype("C:/Windows/Fonts/" + name, size)

frame = Image.new("RGB", (W, H), NAVY)
draw = ImageDraw.Draw(frame)

# The till on the right, tilted card style with a shadow.
screen = Image.open(shots["pos-cart"]).convert("RGB").resize((760, 428), Image.LANCZOS)
mask = Image.new("L", screen.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, *screen.size), 16, fill=255)
shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle((520 + 10, 180 + 16, 520 + 760 + 10, 180 + 428 + 16), 16, fill=(0, 0, 0, 170))
shadow = shadow.filter(ImageFilter.GaussianBlur(16))
frame.paste(shadow, (0, 0), shadow)
frame.paste(screen, (520, 180), mask)

draw = ImageDraw.Draw(frame)
draw.rounded_rectangle((60, 60, 140, 140), 16, fill="white")
draw.text((100, 100), "AP", font=font("segoeuib.ttf", 40), fill=NAVY, anchor="mm")
draw.text((160, 100), "Ajoke POS", font=font("segoeuib.ttf", 48), fill="white", anchor="lm")

draw.text((60, 230), "Point of sale", font=font("segoeuib.ttf", 70), fill="white")
draw.text((60, 315), "for your shop", font=font("segoeuib.ttf", 70), fill="white")
for index, line in enumerate(["Works offline", "VAT, stock, quotations", "Full tutorial"]):
    y = 430 + index * 62
    draw.ellipse((60, y + 12, 80, y + 32), fill=GREEN)
    draw.text((96, y + 22), line, font=font("seguisb.ttf", 38), fill=ACCENT, anchor="lm")

target = out / "Ajoke-POS-Demo-thumbnail.png"
frame.save(target, optimize=True)
print(target)
