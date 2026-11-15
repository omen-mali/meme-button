# Wiring

Source of truth for pin numbers: `firmware/meme_button/config.h`.

| Function | UNO pin | Notes |
|---|---|---|
| Button | D2 | `INPUT_PULLUP`, other leg to GND |
| Buzzer | D5 | 1 kΩ → PN2222 base; buzzer between 5V (via volume network) and collector; 1N4007 across buzzer, stripe to 5V |
| LCD RS / E | D7 / D8 | |
| LCD D4–D7 | D9–D12 | |
| LCD RW | GND | |
| LCD V0 | 10 kΩ to 5V, 1 kΩ to GND | Tune per PLAN.md 2.2 |
| LCD A / K | 5V via 220 Ω / GND | |

Photo: _add breadboard photo here_
