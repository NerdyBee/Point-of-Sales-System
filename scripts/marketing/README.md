# Marketing material: demo video and user manual

These scripts rebuild the demo video and the PDF manual from the real app, so you can regenerate them after an update. Output goes to `release/marketing/`, which git ignores.

| File | What it is |
|---|---|
| `Ajoke-POS-User-Manual.pdf` | A4 manual for clients' staff and for marketing |
| `Ajoke-POS-Demo.mp4` | Narrated 1080p demo and guide video |
| `Ajoke-POS-Demo-WhatsApp.mp4` | Smaller 720p copy for WhatsApp and social media |
| `Ajoke-POS-Demo.srt` | Subtitles for YouTube and Facebook uploads |

## Rebuild

```powershell
npm run release -- --office              # the packaged app that gets filmed
python scripts/marketing/tiles.py        # product pictures for the demo shop
npx tsx scripts/marketing/demo.ts        # demo shop + 23 screenshots (about 2 minutes)
python scripts/marketing/manual.py       # PDF manual
python scripts/marketing/video.py        # video + subtitles (about 5 minutes)
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
- **`manual.py`**: the manual's text, chapter by chapter.
- **`demo.ts`**: which screens are captured and in what order.

To record your own voice-over, use the narration text in `story.json`, or the timings in the `.srt` file. Replace the audio with ffmpeg, or in any video editor.
