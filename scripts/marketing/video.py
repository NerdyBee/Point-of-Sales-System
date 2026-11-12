"""Demo/guide video from the screenshots: one scene per screen, captions and a Windows voice.

    npx tsx scripts/marketing/demo.ts       (screenshots first)
    python scripts/marketing/video.py                       -> release/marketing/Ajoke-POS-Demo.mp4 (+ .srt)
    python scripts/marketing/video.py install-story.json    -> the installation guide video

A story's "output" names the files; a scene shows the screenshot with its id, or its
"image" (a file under release/marketing, such as an installer illustration).

Scenes, captions and narration are in scripts/marketing/story.json. Needs ffmpeg on PATH
and Windows (System.Speech) for the voice.
"""
import json
import sys
import subprocess
import wave
from xml.sax.saxutils import escape
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

root = Path(__file__).resolve().parents[2]
out = root / "release/marketing"
story = json.loads((root / "scripts/marketing" / (sys.argv[1] if len(sys.argv) > 1 else "story.json")).read_text(encoding="utf-8"))
output_name = story.get("output", "Ajoke-POS-Demo")
work = out / "video-work" / output_name
shots = {shot["id"]: out / "shots" / shot["file"] for shot in json.loads((out / "shots.json").read_text(encoding="utf-8"))["shots"]}

W, H = 1920, 1080
NAVY = (7, 2, 53)
ACCENT = (227, 223, 255)
FONTS = "C:/Windows/Fonts/"
font = lambda name, size: ImageFont.truetype(FONTS + name, size)
work.mkdir(parents=True, exist_ok=True)


def wrap(draw, text, face, width):
    lines, line = [], ""
    for word in text.split():
        test = f"{line} {word}".strip()
        if draw.textlength(test, font=face) > width and line:
            lines.append(line)
            line = word
        else:
            line = test
    return lines + [line]


def caption_band(draw, text, top):
    face = font("seguisb.ttf", 46)
    lines = wrap(draw, text, face, W - 240)
    for index, line in enumerate(lines):
        draw.text((W / 2, top + index * 58), line, font=face, fill="white", anchor="mm")


def brand_corner(draw):
    draw.rounded_rectangle((40, 30, 92, 82), 10, fill="white")
    draw.text((66, 56), "AP", font=font("segoeuib.ttf", 26), fill=NAVY, anchor="mm")
    draw.text((106, 56), "Ajoke POS", font=font("seguisb.ttf", 30), fill="white", anchor="lm")


def screen_frame(image_path, caption):
    """Screenshot framed on the brand colour with a caption underneath."""
    frame = Image.new("RGB", (W, H), NAVY)
    shot = Image.open(image_path).convert("RGB")
    if abs(shot.width / shot.height - 1536 / 864) > 0.02:
        # A printed page (receipt, quotation, statement): fitted whole on a light panel, not stretched.
        page = shot.copy()
        page.thumbnail((1536 - 80, 864 - 40), Image.LANCZOS)
        panel = Image.new("RGB", (1536, 864), (232, 236, 243))
        ImageDraw.Draw(panel).rectangle(((1536 - page.width) // 2 + 6, 26, (1536 + page.width) // 2 + 6, 26 + page.height), fill=(200, 205, 215))
        panel.paste(page, ((1536 - page.width) // 2, 20))
        shot = panel
    else:
        shot = shot.resize((1536, 864), Image.LANCZOS)
    mask = Image.new("L", shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *shot.size), 18, fill=255)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((192 + 6, 100 + 14, 192 + 1536 + 6, 100 + 864 + 14), 18, fill=(0, 0, 0, 150))
    frame.paste(shadow.filter(ImageFilter.GaussianBlur(14)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(14)))
    frame.paste(shot, (192, 100), mask)
    draw = ImageDraw.Draw(frame)
    brand_corner(draw)
    caption_band(draw, caption, 1010)
    return frame


def title_frame(title, subtitle, footer=None):
    frame = Image.new("RGB", (W, H), NAVY)
    backdrop = shots.get("pos") or next(iter(shots.values()))
    faded = Image.open(backdrop).convert("RGB").resize((W, H)).filter(ImageFilter.GaussianBlur(6))
    frame = Image.blend(frame, faded, 0.18)
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle((W / 2 - 70, 250, W / 2 + 70, 390), 28, fill="white")
    draw.text((W / 2, 320), "AP", font=font("segoeuib.ttf", 72), fill=NAVY, anchor="mm")
    draw.text((W / 2, 500), title, font=font("segoeuib.ttf", 120), fill="white", anchor="mm")
    for index, line in enumerate(wrap(draw, subtitle, font("segoeui.ttf", 52), 1500)):
        draw.text((W / 2, 610 + index * 66), line, font=font("segoeui.ttf", 52), fill=ACCENT, anchor="mm")
    if footer:
        draw.text((W / 2, 900), footer, font=font("seguisb.ttf", 46), fill="white", anchor="mm")
    return frame


def to_ssml(text):
    """Narration as SSML, so names get the pronunciation set in story.json "pronounce"."""
    spoken = escape(text)
    for word, rule in story.get("pronounce", {}).items():
        replacement = f'<phoneme alphabet="ipa" ph="{escape(rule["ipa"])}">{word}</phoneme>' if "ipa" in rule else escape(rule["say"])
        spoken = spoken.replace(word, replacement)
    return f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">{spoken}</speak>'


def speak(scenes):
    """All narration in one PowerShell call (System.Speech) -> one WAV per scene."""
    jobs = [{"ssml": to_ssml(scene["narration"]), "path": str(work / f"{scene['id']}.wav")} for scene in scenes]
    (work / "narration.json").write_text(json.dumps(jobs), encoding="utf-8")
    script = f"""
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{ $voice.SelectVoice('{story['voice']}') }} catch {{}}
$voice.Rate = -1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($job in (Get-Content -Raw -Encoding UTF8 '{work / 'narration.json'}' | ConvertFrom-Json)) {{
  $voice.SetOutputToWaveFile($job.path, $format)
  $voice.SpeakSsml($job.ssml)
}}
$voice.SetOutputToNull()
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)


def seconds(wav_path):
    with wave.open(str(wav_path)) as audio:
        return audio.getnframes() / audio.getframerate()


def srt_time(value):
    millis = int(round(value * 1000))
    return f"{millis // 3_600_000:02d}:{millis // 60_000 % 60:02d}:{millis // 1000 % 60:02d},{millis % 1000:03d}"


def main():
    scenes = [scene for scene in story["scenes"] if scene["id"] in ("intro", "outro") or scene["id"] in shots or scene.get("image")]
    print(f"{len(scenes)} scenes; generating narration...")
    speak(scenes)

    segments, subtitles, chapters, clock = [], [], [], 0.0
    for index, scene in enumerate(scenes):
        if scene["id"] == "intro":
            image = title_frame(story["title"], story["tagline"])
        elif scene["id"] == "outro":
            vendor = story["vendor"]
            image = title_frame("Ajoke POS", f"by {vendor['name']}", f"WhatsApp {vendor['phone']}")
        else:
            image = screen_frame(out / scene["image"] if scene.get("image") else shots[scene["id"]], scene["caption"])
        frame_path = work / f"{index:02d}-{scene['id']}.png"
        image.save(frame_path)

        voice = work / f"{scene['id']}.wav"
        talk = seconds(voice)
        duration = max(4.0, talk + 1.3)
        segment = work / f"{index:02d}.mp4"
        frames = int(duration * 30)
        # Slow push-in (Ken Burns), short fades, narration starts after 0.4 s.
        video_filter = (
            f"scale=3840:-1,zoompan=z='min(1+0.0004*on,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps=30,"
            f"fade=t=in:st=0:d=0.4,fade=t=out:st={duration - 0.4:.2f}:d=0.4,format=yuv420p"
        )
        subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(frame_path), "-i", str(voice),
            "-filter_complex", f"[0:v]{video_filter}[v];[1:a]adelay=400|400,apad,atrim=0:{duration:.2f},aresample=44100[a]",
            "-map", "[v]", "-map", "[a]", "-t", f"{duration:.2f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-ac", "2", str(segment)
        ], check=True)
        segments.append(segment)
        if scene.get("chapter"):
            chapters.append((clock, scene["chapter"]))
        subtitles.append((clock + 0.4, clock + 0.4 + talk, scene["narration"]))
        clock += duration
        print(f"  {index + 1:2d}/{len(scenes)} {scene['id']} ({duration:.1f}s)")

    listing = work / "segments.txt"
    listing.write_text("".join(f"file '{segment.as_posix()}'\n" for segment in segments), encoding="utf-8")
    final = out / f"{output_name}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(final)], check=True)
    (out / f"{output_name}.srt").write_text(
        "".join(f"{number}\n{srt_time(start)} --> {srt_time(end)}\n{text}\n\n" for number, (start, end, text) in enumerate(subtitles, 1)), encoding="utf-8"
    )
    if chapters:
        # YouTube chapters: paste into the video description (the first must be 0:00).
        stamp = lambda value: f"{int(value) // 60}:{int(value) % 60:02d}"
        (out / f"{output_name}-chapters.txt").write_text("".join(f"{stamp(start)} {title}\n" for start, title in chapters), encoding="utf-8")
    print(f"\n{final} ({clock / 60:.1f} min)")


if __name__ == "__main__":
    main()
