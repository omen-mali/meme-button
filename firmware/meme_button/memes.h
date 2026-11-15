#pragma once
#include <avr/pgmspace.h>
#include "pitches.h"

struct Note { uint16_t freq; uint16_t ms; };   // freq 0 = rest

// Placeholder only. Builder transcribes the real melody.
const Note MELODY_RICKROLL[] PROGMEM = {
  {NOTE_C5, 200}, {0, 50}, {NOTE_E5, 200}, {0, 50}, {NOTE_G5, 400},
};

struct Meme {
  const char* id;            // must match a key in web/memes.js, [a-z0-9_]
  const char* lcdTitle;      // 16 chars max
  const Note* melody;        // PROGMEM
  uint16_t noteCount;
  uint8_t frameSet;          // index into lcd_frames.h
};

const Meme MEMES[] = {
  { "rickroll", "You got rolled", MELODY_RICKROLL,
    sizeof(MELODY_RICKROLL) / sizeof(Note), 0 },
  // P3: add more entries here, then the matching keys in web/memes.js
};
const uint8_t MEME_COUNT = sizeof(MEMES) / sizeof(Meme);
