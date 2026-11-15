#pragma once
#include <Arduino.h>

// Pin map: see docs/wiring.md
constexpr uint8_t PIN_BUTTON = 2;   // INPUT_PULLUP, pressed = LOW
constexpr uint8_t PIN_BUZZER = 5;   // via PN2222 driver
constexpr uint8_t PIN_LCD_RS = 7;
constexpr uint8_t PIN_LCD_E  = 8;
constexpr uint8_t PIN_LCD_D4 = 9;
constexpr uint8_t PIN_LCD_D5 = 10;
constexpr uint8_t PIN_LCD_D6 = 11;
constexpr uint8_t PIN_LCD_D7 = 12;

constexpr uint32_t BAUD = 115200;
constexpr const char* FW_VERSION = "0.9-demo";
constexpr uint8_t SERIAL_LINE_MAX = 32;  // longer incoming lines are dropped

constexpr uint16_t DEBOUNCE_MS  = 30;
constexpr uint16_t FRAME_MS     = 250;  // LCD sprite frame period
constexpr uint8_t  LCD_COLS     = 16;
constexpr uint8_t  LCD_ROWS     = 2;
// Idle row 0 per word: hold the start, scroll until the end is visible, hold the end
constexpr uint16_t IDLE_WORD_MS  = 3000; // total time per word
constexpr uint16_t IDLE_START_MS = 500;  // hold before scrolling
constexpr uint16_t IDLE_STEP_MS  = 200;  // per one-character scroll step
constexpr uint16_t TAUNT_MS      = 4000; // taunt scroll repeats this often
constexpr uint16_t ROLLED_MS     = 6000; // meme title after the roll, then idle
constexpr uint16_t AUTO_TAUNT_MS = 20000; // 1st press: melody stops into the taunt after this
constexpr uint8_t  OCTAVE_SHIFT = 0;    // 1 = x2, 2 = x4; louder near buzzer resonance

// 0 = Option A (analog volume, no code). 1 = Option B (toneAC + pot on A0).
#define VOLUME_SOFTWARE 0
