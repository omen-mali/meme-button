# Meme Button

Stupid Ideas Hackathon Ottawa F26. Track: **Stupidest Button**.

A physical button on an Arduino UNO. Press it and the buzzer plays a meme while the LCD runs a tiny animation. Hooked to a web page connected over USB (Web Serial) that reacts to the same press with a synced visual.

## Team
- Momen Ali (Solo 😃)

## Layout
| Path | What |
|---|---|
| `firmware/meme_button/` | Arduino sketch (source of truth for playback state) |
| `web/` | Static page, Web Serial client |
| `docs/wiring.md` | Pin table and breadboard photo |

## Run
Firmware (uses the arduino-cli bundled with Arduino IDE 2):
```sh
make compile
make upload          # auto-detects /dev/cu.usbmodem* or /dev/cu.usbserial*
make monitor         # 115200 baud; close it before connecting the web page
```

Web (Chrome or Edge, Web Serial needs localhost or HTTPS):
```sh
make web             # http://localhost:8000
```

## Conventions
- Serial protocol: UPPERCASE tokens, space-separated args, `\n` terminated.
- Meme IDs: lowercase `[a-z0-9_]`, identical in `firmware/meme_button/memes.h` and `web/memes.js`.
- Firmware: no `delay()` in `loop()` paths, constants in `config.h`, strings via `F()`, melodies in PROGMEM.
- Melodies in the repo are placeholders. No copyrighted audio or video committed; link or embed instead.
