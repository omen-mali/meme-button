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
constexpr const char* FW_VERSION = "0.4";
constexpr uint8_t SERIAL_LINE_MAX = 32;  // longer incoming lines are dropped

constexpr uint16_t DEBOUNCE_MS  = 30;
constexpr uint16_t FRAME_MS     = 250;  // LCD sprite frame period
constexpr uint8_t  LCD_COLS     = 16;
constexpr uint8_t  LCD_ROWS     = 2;
constexpr uint8_t  OCTAVE_SHIFT = 0;    // 1 = x2, 2 = x4; louder near buzzer resonance

// 0 = Option A (analog volume, no code). 1 = Option B (toneAC + pot on A0).
#define VOLUME_SOFTWARE 0
