# Marketing material: demo video and user manual

These scripts rebuild the demo video and the PDF manual from the real app, so you can regenerate them after an update. Output goes to `release/marketing/`, which git ignores.

| File | What it is |
|---|---|
| `Ajoke-POS-User-Manual.pdf` | A4 manual for clients' staff and for marketing |
| `Ajoke-POS-Demo.mp4` | Narrated 1080p demo and guide video |
| `Ajoke-POS-Demo-WhatsApp.mp4` | Smaller 720p copy for WhatsApp and social media |
| `Ajoke-POS-Demo.srt` | Subtitles for YouTube and Facebook uploads |
| `Ajoke-POS-Demo-chapters.txt` | YouTube chapters: paste into the video description |
| `Ajoke-POS-Demo-thumbnail.png` | 1280x720 YouTube thumbnail |
| `youtube.md` (in this folder) | Titles, descriptions and tags for the YouTube uploads |
| `Ajoke-POS-Installation-Guide.pdf` | A4 guide for clients installing the office server themselves |
| `Ajoke-POS-Installation.mp4` (+ `-WhatsApp.mp4`, `.srt`) | Narrated installation video |

The Windows steps in the installation guide and video (extracting the zip, the permission prompts, the installer window) are drawings by `install_art.py`. Running the real installer would change the build machine's Windows services. The steps inside the app use real screenshots.

## Rebuild

```powershell
npm run release -- --office              # the packaged app that gets filmed
python scripts/marketing/tiles.py        # product pictures for the demo shop
npx tsx scripts/marketing/demo.ts        # demo shop + about 34 screenshots (about 3 minutes)
python scripts/marketing/manual.py       # PDF manual
python scripts/marketing/video.py        # video, subtitles and YouTube chapters (about 8 minutes)
python scripts/marketing/thumbnail.py    # YouTube thumbnail
python scripts/marketing/install_art.py  # installer illustrations
python scripts/marketing/install_guide.py                 # installation guide PDF
python scripts/marketing/video.py install-story.json     # installation video
ffmpeg -i release/marketing/Ajoke-POS-Demo.mp4 -vf scale=1280:720 -c:v libx264 -crf 28 -c:a aac -b:a 96k release/marketing/Ajoke-POS-Demo-WhatsApp.mp4
```

Requirements:
- Windows, with Chrome or Edge installed.
- `ffmpeg` on the PATH.
- Python with Pillow and reportlab.
- The vendor signing key `mobile/.license/private-key.json`. The demo copy is activated without being written to `issued.csv`.

## Changing the content

- **`demo-data.json`**: the demo shop (Green Basket Market, USD), with its products, staff, customers, suppliers and expenses.
- **`story.json`**: the video's scenes, captions and narration, and the voice (`Microsoft Zira Desktop`; `Microsoft David Desktop` also works). It also holds your contact details for the title and closing cards.
- **`manual.py`**: the manual's text, chapter by chapter, and the PDF design that `install_guide.py` reuses.
- **`install_guide.py`** and **`install-story.json`**: the installation guide and video. Keep them in step with `deploy/office/README.txt` and `install.ps1`.
- **`story.json` `"pronounce"`**: how the voice says "Ajoke" (Yoruba Àjọkẹ́).
- **`demo.ts`**: which screens are captured and in what order. Printed documents (receipt, quotation, statement, credit note) are captured from their print windows.
- **`import-sample.xlsx`**: the spreadsheet shown in the Excel import scene.
- **`story.json` `"chapter"`**: a scene with a chapter title starts a YouTube chapter (each must last at least 10 seconds).

**Rebuild the video after every release that changes what users see**, so the YouTube video matches the app. Re-upload it as a new video (YouTube cannot replace a video's file) and update the links you have shared.

To record your own voice-over, use the narration text in `story.json`, or the timings in the `.srt` file. Replace the audio with ffmpeg, or in any video editor.
