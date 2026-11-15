#include <LiquidCrystal.h>
#include "config.h"
#include "pitches.h"
#include "memes.h"
#include "lcd_frames.h"

enum State : uint8_t { IDLE, PLAYING };

static LiquidCrystal lcd(PIN_LCD_RS, PIN_LCD_E, PIN_LCD_D4, PIN_LCD_D5, PIN_LCD_D6, PIN_LCD_D7);

static State state = IDLE;
static uint8_t current = 0;       // index into MEMES
static uint16_t noteIndex = 0;
static uint32_t nextNoteAt = 0;
static uint16_t playCount = 0;

static uint8_t spriteCol = 0;
static uint8_t spriteGlyph = 0;   // CGRAM slot currently shown
static uint32_t nextFrameAt = 0;

// ---- Protocol output (PLAN.md 3) ----

static void sendWithId(const __FlashStringHelper* tag, const char* id) {
  Serial.print(tag);
  Serial.print(' ');
  Serial.print(id);
}

// ---- LCD ----

// Writes text on a full row, padding with spaces, so no lcd.clear() is needed.
static void printRow(uint8_t row, const char* text) {
  lcd.setCursor(0, row);
  uint8_t n = 0;
  for (; text[n] && n < LCD_COLS; n++) lcd.write(text[n]);
  for (; n < LCD_COLS; n++) lcd.write(' ');
}

static void showIdle() {
  lcd.setCursor(0, 0);
  lcd.print(F("  DO NOT PRESS  "));
  lcd.setCursor(0, 1);
  lcd.print(F("  (seriously)   "));
}

static void loadFrameSet(uint8_t i) {
  const FrameSet& set = FRAME_SETS[i];
  uint8_t glyph[8];
  for (uint8_t slot = 0; slot < set.glyphCount; slot++) {
    memcpy_P(glyph, set.glyphs[slot], sizeof(glyph));
    lcd.createChar(slot, glyph);
  }
}

static void startLcd(const Meme& meme, uint32_t now) {
  loadFrameSet(meme.frameSet);   // once per meme, not per frame
  printRow(0, meme.lcdTitle);
  printRow(1, "");
  spriteCol = 0;
  spriteGlyph = 0;
  lcd.setCursor(spriteCol, 1);
  lcd.write(spriteGlyph);
  nextFrameAt = now + FRAME_MS;
}

// Sprite walks along row 1, cycling glyphs. Only the two changed cells are rewritten.
static void updateLcd(uint32_t now) {
  if (state != PLAYING || (int32_t)(now - nextFrameAt) < 0) return;
  nextFrameAt += FRAME_MS;

  lcd.setCursor(spriteCol, 1);
  lcd.write(' ');
  spriteCol = (spriteCol + 1) % LCD_COLS;
  spriteGlyph = (spriteGlyph + 1) % FRAME_SETS[MEMES[current].frameSet].glyphCount;
  lcd.setCursor(spriteCol, 1);
  lcd.write(spriteGlyph);
}

// ---- Player ----

static void stopPlayback() {
  noTone(PIN_BUZZER);
  state = IDLE;
  sendWithId(F("END"), MEMES[current].id);
  Serial.println();
}

static void endMeme() {
  stopPlayback();
  showIdle();
}

static void startMeme(uint8_t i, uint32_t now) {
  if (state == PLAYING) stopPlayback();   // restart: skip the idle screen
  current = i;
  state = PLAYING;
  noteIndex = 0;
  nextNoteAt = now;

  sendWithId(F("START"), MEMES[i].id);
  Serial.print(' ');
  Serial.println(MEMES[i].noteCount);
  Serial.print(F("COUNT "));
  Serial.println(++playCount);

  startLcd(MEMES[i], now);
}

static void updatePlayer(uint32_t now) {
  if (state != PLAYING || (int32_t)(now - nextNoteAt) < 0) return;

  const Meme& meme = MEMES[current];
  if (noteIndex >= meme.noteCount) {
    endMeme();
    return;
  }

  Note n;
  memcpy_P(&n, &meme.melody[noteIndex], sizeof(Note));
  if (n.freq) {
    // 32-bit math: int is 16-bit on AVR
    tone(PIN_BUZZER, (uint32_t)n.freq << OCTAVE_SHIFT, (uint32_t)n.ms * 9 / 10);
  } else {
    noTone(PIN_BUZZER);
  }

  sendWithId(F("NOTE"), meme.id);
  Serial.print(' ');
  Serial.println(noteIndex);

  noteIndex++;
  nextNoteAt += n.ms;   // relative to previous target, not now, to avoid drift
}

// ---- Button ----

static void onPress(uint32_t now) {
  Serial.println(F("PRESS"));
  startMeme(current, now);   // pressing mid-melody restarts it
}

static void pollButton(uint32_t now) {
  static bool lastReading = HIGH;
  static bool stable = HIGH;
  static uint32_t changedAt = 0;

  bool reading = digitalRead(PIN_BUTTON);
  if (reading != lastReading) {
    lastReading = reading;
    changedAt = now;
  }
  if (reading != stable && now - changedAt >= DEBOUNCE_MS) {
    stable = reading;
    if (stable == LOW) onPress(now);
  }
}

void setup() {
  Serial.begin(BAUD);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  lcd.begin(LCD_COLS, LCD_ROWS);
  showIdle();

  Serial.print(F("READY "));
  Serial.println(FW_VERSION);
}

void loop() {
  uint32_t now = millis();
  pollButton(now);
  // H4: pollSerial();
  updatePlayer(now);
  updateLcd(now);
}
