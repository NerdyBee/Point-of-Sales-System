"""Illustrations of the Windows installation steps for the installation guide and video.

    python scripts/marketing/install_art.py   -> release/marketing/install-art/*.png (1920x1080)

These are drawings, not screen recordings: the installer changes Windows services and
startup tasks, so it is not run on the build machine. The installer window shows the real
messages from deploy/office/install.ps1; keep them in step if those change.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
out = root / "release/marketing/install-art"
out.mkdir(parents=True, exist_ok=True)

W, H = 1920, 1080
NAVY = (7, 2, 53)
INK = (25, 28, 30)
MUTED = (95, 102, 112)
LINE = (200, 207, 216)
PAPER = (247, 249, 251)
HIGHLIGHT = (255, 214, 0)
FONTS = "C:/Windows/Fonts/"


def font(name, size):
    return ImageFont.truetype(FONTS + name, size)


def emoji(char, size):
    glyph = Image.new("RGBA", (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((80, 80), char, font=font("seguiemj.ttf", 109), embedded_color=True, anchor="mm")
    return glyph.resize((size, size), Image.LANCZOS)


def canvas(title):
    image = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(image)
    draw.text((90, 70), title, font=font("segoeuib.ttf", 64), fill=NAVY)
    return image, draw


def callout(draw, box, width=8):
    draw.rounded_rectangle(box, 16, outline=HIGHLIGHT, width=width)


def need():
    image, draw = canvas("What you need")
    items = [
        ("💻", "A Windows 10 or 11 computer", "64-bit, stays on while the shop is open"),
        ("🔑", "Administrator access", "To click Yes when Windows asks"),
        ("📦", "The Ajoke POS zip file", "From your Ajoke POS provider"),
        ("📱", "Your provider on WhatsApp", "To receive your activation code"),
    ]
    for index, (icon, title, detail) in enumerate(items):
        x = 90 + (index % 2) * 880
        y = 220 + (index // 2) * 400
        draw.rounded_rectangle((x, y, x + 840, y + 350), 28, fill="white", outline=LINE, width=2)
        image.paste(emoji(icon, 150), (x + 50, y + 100), emoji(icon, 150))
        draw.text((x + 240, y + 120), title, font=font("seguisb.ttf", 42), fill=INK)
        draw.text((x + 240, y + 185), detail, font=font("segoeui.ttf", 30), fill=MUTED)
    return image


def extract():
    image, draw = canvas("1. Extract the zip file")
    # The zip and its right-click menu.
    draw.rounded_rectangle((90, 220, 820, 960), 28, fill="white", outline=LINE, width=2)
    draw.text((90, 985), "Right-click, then Extract All", font=font("seguisb.ttf", 34), fill=NAVY)
    zip_icon = emoji("📦", 170)
    image.paste(zip_icon, (130, 270), zip_icon)
    draw.text((330, 300), "AjokePOS-Office-0.1.0.zip", font=font("seguisb.ttf", 34), fill=INK)
    draw.text((330, 350), "Right-click the zip file", font=font("segoeui.ttf", 28), fill=MUTED)
    menu = (230, 480, 780, 900)
    draw.rounded_rectangle(menu, 14, fill=(250, 250, 250), outline=LINE, width=2)
    for index, entry in enumerate(["Open", "Extract All...", "Share", "Copy as path", "Properties"]):
        y = 500 + index * 78
        if entry == "Extract All...":
            draw.rounded_rectangle((242, y - 4, 768, y + 64), 10, fill=(224, 236, 255))
            callout(draw, (236, y - 10, 774, y + 70))
        draw.text((280, y + 8), entry, font=font("seguisb.ttf" if entry == "Extract All..." else "segoeui.ttf", 32), fill=INK)
    # Arrow.
    draw.polygon([(870, 560), (980, 560), (980, 520), (1060, 590), (980, 660), (980, 620), (870, 620)], fill=NAVY)
    # The extracted folder.
    draw.rounded_rectangle((1100, 220, 1830, 960), 28, fill="white", outline=LINE, width=2)
    folder = emoji("📁", 110)
    image.paste(folder, (1140, 250), folder)
    draw.text((1270, 280), "AjokePOS", font=font("seguisb.ttf", 40), fill=INK)
    files = [("📁", "mariadb"), ("📁", "node"), ("📁", "server"), ("🚀", "Install.cmd"), ("📄", "README.txt"), ("📄", "backup.ps1"), ("📄", "connect-cloud.ps1"), ("📄", "uninstall.ps1")]
    for index, (icon, name) in enumerate(files):
        y = 400 + index * 66
        if name == "Install.cmd":
            draw.rounded_rectangle((1150, y - 6, 1780, y + 56), 10, fill=(224, 236, 255))
            callout(draw, (1144, y - 12, 1786, y + 62))
        small = emoji(icon, 44)
        image.paste(small, (1170, y + 2), small)
        draw.text((1240, y + 4), name, font=font("seguisb.ttf" if name == "Install.cmd" else "segoeui.ttf", 32), fill=INK)
    draw.text((1100, 985), "Then double-click Install.cmd", font=font("seguisb.ttf", 34), fill=NAVY)
    return image


def dialog(draw, box, header_color, title, lines, buttons, highlight):
    x1, y1, x2, y2 = box
    draw.rounded_rectangle(box, 18, fill="white", outline=LINE, width=2)
    draw.rounded_rectangle((x1, y1, x2, y1 + 120), 18, fill=header_color)
    draw.rectangle((x1, y1 + 100, x2, y1 + 120), fill=header_color)
    draw.text((x1 + 40, y1 + 34), title, font=font("seguisb.ttf", 36), fill="white")
    for index, text in enumerate(lines):
        draw.text((x1 + 40, y1 + 160 + index * 52), text, font=font("segoeui.ttf", 30), fill=INK)
    for index, label in enumerate(buttons):
        bx = x2 - 40 - (len(buttons) - index) * 230
        rect = (bx, y2 - 120, bx + 210, y2 - 50)
        draw.rounded_rectangle(rect, 10, fill=(0, 95, 184) if label == highlight else (235, 237, 240))
        draw.text(((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2), label, font=font("seguisb.ttf", 30), fill="white" if label == highlight else INK, anchor="mm")
        if label == highlight:
            callout(draw, (rect[0] - 10, rect[1] - 10, rect[2] + 10, rect[3] + 10))


def security():
    image, draw = canvas("2. Allow the installer to run")
    dialog(draw, (90, 230, 930, 840), (0, 95, 184), "User Account Control",
           ["Do you want to allow this app to make", "changes to your device?", "", "Windows PowerShell"], ["Yes", "No"], "Yes")
    draw.text((90, 870), "Click Yes.", font=font("seguisb.ttf", 34), fill=NAVY)
    dialog(draw, (990, 230, 1830, 840), (0, 120, 212), "Windows protected your PC",
           ["Shown only on some computers.", "Click More info, then:", "", "App: Install.cmd"], ["Run anyway", "Don't run"], "Run anyway")
    draw.text((990, 870), "If you see this, click More info, then Run anyway.", font=font("seguisb.ttf", 34), fill=NAVY)
    return image


def console(title, lines):
    image, draw = canvas(title)
    draw.rounded_rectangle((90, 190, 1830, 1010), 18, fill=(12, 12, 12))
    draw.rounded_rectangle((90, 190, 1830, 250), 18, fill=(44, 44, 44))
    draw.rectangle((90, 230, 1830, 250), fill=(44, 44, 44))
    draw.text((130, 220), "Administrator: Windows PowerShell", font=font("segoeui.ttf", 26), fill=(220, 220, 220), anchor="lm")
    mono = font("consola.ttf", 29)
    colors = {"cyan": (97, 214, 214), "green": (22, 198, 12), "yellow": (249, 241, 165), "white": (204, 204, 204), "input": (255, 255, 255)}
    y = 280
    for text, color in lines:
        draw.text((130, y), text, font=mono, fill=colors[color])
        y += 40
    return image


def install_console():
    return console("3. Wait while Ajoke POS installs", [
        ("Ajoke POS office server - installation into C:\\AjokePOS", "green"),
        ("", "white"),
        ("== Stopping Ajoke POS if it is running", "cyan"),
        ("== Copying program files", "cyan"),
        ("== Setting up the database", "cyan"),
        ("== Creating or updating tables", "cyan"),
        ("Your database is now in sync with your Prisma schema.", "white"),
        ("== Registering Ajoke POS to start with Windows", "cyan"),
        ("", "white"),
        ("== Connect to the cloud server", "cyan"),
        ("Cloud address (e.g. https://pos.yourbusiness.com), or press Enter to skip:", "input"),
        ("Skipped. Run connect-cloud.ps1 in C:\\AjokePOS later to connect.", "white"),
        ("", "white"),
        ("== Starting Ajoke POS", "cyan"),
        ("", "white"),
        ("Ajoke POS is running.", "green"),
        ("  Device code : EAZX-MWU9-J8M6", "yellow"),
    ])


def finish_console():
    return console("4. Installation finished", [
        ("== Starting Ajoke POS", "cyan"),
        ("", "white"),
        ("Ajoke POS is running.", "green"),
        ("  Device code : EAZX-MWU9-J8M6", "yellow"),
        ("  Not active  : This copy of Ajoke POS is not activated yet.", "yellow"),
        ("  Send the device code above to your Ajoke POS provider for your activation code.", "yellow"),
        ("  On this computer : http://localhost:4000 (shortcut on the desktop)", "white"),
        ("  Other devices    : http://192.168.1.20:4000", "white"),
        ("  Backups          : C:\\AjokePOS\\backups (every day at 21:00)", "white"),
        ("Press Enter to close:", "input"),
    ])


for name, build in [("need", need), ("extract", extract), ("security", security), ("console", install_console), ("finished", finish_console)]:
    build().save(out / f"{name}.png")
    print(out / f"{name}.png")
