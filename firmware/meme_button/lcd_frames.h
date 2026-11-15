#pragma once
#include <avr/pgmspace.h>

// Custom 5x8 glyphs for the LCD1602. The display holds at most 8 at once
// (CGRAM slots 0-7), so each frame set has at most 8 glyphs. Glyph i is
// loaded into slot i; the animation cycles through slots 0..glyphCount-1.

// Dancer: arms up / arms down
const uint8_t GLYPHS_DANCER[][8] PROGMEM = {
  { 0b00100,
    0b10101,
    0b01110,
    0b00100,
    0b00100,
    0b01010,
    0b10001,
    0b00000 },
  { 0b00100,
    0b00100,
    0b01110,
    0b10101,
    0b00100,
    0b01010,
    0b01010,
    0b00000 },
};

struct FrameSet {
  const uint8_t (*glyphs)[8];   // PROGMEM
  uint8_t glyphCount;           // <= 8
};

// Indexed by Meme.frameSet
const FrameSet FRAME_SETS[] = {
  { GLYPHS_DANCER, sizeof(GLYPHS_DANCER) / sizeof(GLYPHS_DANCER[0]) },
};
