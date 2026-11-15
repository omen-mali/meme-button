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
static bool cycleMode = true;     // MODE cycle: advance to the next meme after each END

static uint8_t spriteCol = 0;
static uint8_t spriteGlyph = 0;   // CGRAM slot currently shown
static uint32_t nextFrameAt = 0;

static uint16_t lyricIndex = 0;   // next cue in MEMES[current].lyrics
static uint8_t lyricLen = 0;      // chars of lyrics on LCD row 0
static bool lyricFresh = true;    // row 0 still shows the title

// ---- Protocol output ----

static void sendWithId(const __FlashStringHelper* tag, const char* id) {
  Serial.print(tag);
  Serial.print(' ');
  Serial.print(id);
}

static void sendMode() {
  Serial.println(cycleMode ? F("MODE cycle") : F("MODE single"));
}

static void sendMemes() {
  Serial.print(F("MEMES "));
  for (uint8_t i = 0; i < MEME_COUNT; i++) {
    if (i) Serial.print(',');
    Serial.print(MEMES[i].id);
  }
  Serial.println();
}

// ---- LCD ----

// Writes text on a full row, padding with spaces, so no lcd.clear() is needed.
static void printRow(uint8_t row, const char* text) {
  lcd.setCursor(0, row);
  uint8_t n = 0;
  for (; text[n] && n < LCD_COLS; n++) lcd.write(text[n]);
  for (; n < LCD_COLS; n++) lcd.write(' ');
}

// Idle row 0: IDLE_PREFIX + word scrolls left; after each full pass the next word swaps in.
static const char IDLE_PREFIX[] = "PRESS FOR FREE ";
static const char* const IDLE_WORDS[] = { "FOOD", "MONEY", "VBUCKS", "PIZZA", "CANDY", "WIFI" };
constexpr uint8_t IDLE_WORD_COUNT = sizeof(IDLE_WORDS) / sizeof(IDLE_WORDS[0]);

static char idleText[32];         // IDLE_PREFIX + current word
static uint8_t idleWord = 0;
static uint8_t idleOffset = 0;    // marquee position
static uint8_t idleLoopLen = 0;   // text + IDLE_GAP
static uint16_t idleStepMs = 0;
static uint32_t nextIdleStepAt = 0;

static void drawIdleRow() {
  uint8_t textLen = idleLoopLen - IDLE_GAP;
  lcd.setCursor(0, 0);
  for (uint8_t col = 0; col < LCD_COLS; col++) {
    uint8_t i = (idleOffset + col) % idleLoopLen;
    lcd.write(i < textLen ? idleText[i] : ' ');
  }
}

// IDLE <passMs> <elapsedMs> <text>: lets the page run the same pass in step with the LCD
static void sendIdle(uint32_t now) {
  int32_t untilStep = (int32_t)(nextIdleStepAt - now);
  uint32_t elapsed = (uint32_t)(idleOffset + 1) * idleStepMs - max(untilStep, (int32_t)0);
  Serial.print(F("IDLE "));
  Serial.print((uint32_t)idleStepMs * idleLoopLen);
  Serial.print(' ');
  Serial.print(elapsed);
  Serial.print(' ');
  Serial.println(idleText);
}

static void setIdleWord(uint8_t word, uint32_t now) {
  idleWord = word;
  strlcpy(idleText, IDLE_PREFIX, sizeof(idleText));
  strlcat(idleText, IDLE_WORDS[word], sizeof(idleText));
  idleLoopLen = strlen(idleText) + IDLE_GAP;
  idleStepMs = IDLE_WORD_MS / idleLoopLen;   // one pass takes ~IDLE_WORD_MS
  idleOffset = 0;
  nextIdleStepAt = now + idleStepMs;
  drawIdleRow();
  sendIdle(now);
}

static void showIdle() {
  setIdleWord(idleWord, millis());
  lcd.setCursor(0, 1);
  lcd.print(F("  (seriously)   "));
}

static void updateIdle(uint32_t now) {
  if (state != IDLE || (int32_t)(now - nextIdleStepAt) < 0) return;
  nextIdleStepAt += idleStepMs;
  if (++idleOffset < idleLoopLen) {
    drawIdleRow();
  } else {
    setIdleWord((idleWord + 1) % IDLE_WORD_COUNT, now);   // pass done: back to start, next word
  }
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
  lyricLen = 0;
  lyricFresh = true;
}

// Builds the current lyric line on row 0, wrapping to a fresh row when a chunk doesn't fit.
static void showLyric(uint8_t mode, const char* text) {
  uint8_t len = strlen(text);
  uint8_t sep = (mode == LYRIC_ADD && lyricLen) ? 1 : 0;
  if (mode == LYRIC_NEW || lyricFresh || lyricLen + sep + len > LCD_COLS) {
    printRow(0, text);
    lyricLen = min(len, LCD_COLS);
    lyricFresh = false;
    return;
  }
  lcd.setCursor(lyricLen, 0);
  if (sep) lcd.write(' ');
  lcd.print(text);
  lyricLen += sep + len;
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

static void advanceMeme() {
  current = (current + 1) % MEME_COUNT;
  sendWithId(F("NEXT"), MEMES[current].id);
  Serial.println();
}

// Any end of playback (finished, button stop, STOP) moves on in cycle mode.
static void endMeme() {
  stopPlayback();
  if (cycleMode) advanceMeme();
  showIdle();
}

static void startMeme(uint8_t i, uint32_t now) {
  if (state == PLAYING) stopPlayback();   // PLAY <id> mid-melody: switch, skip the idle screen
  current = i;
  state = PLAYING;
  noteIndex = 0;
  nextNoteAt = now;
  lyricIndex = 0;

  sendWithId(F("START"), MEMES[i].id);
  Serial.print(' ');
  Serial.println(MEMES[i].noteCount);
  Serial.print(F("COUNT "));
  Serial.println(++playCount);

  startLcd(MEMES[i], now);
}

// Fires every cue attached to the note that just started.
// LYRIC <id> <add|new|cont> <text>
static void updateLyrics(const Meme& meme) {
  static const char MODE_NAMES[][5] PROGMEM = { "add", "new", "cont" };
  LyricCue cue;
  while (lyricIndex < meme.lyricCount) {
    memcpy_P(&cue, &meme.lyrics[lyricIndex], sizeof(cue));
    if (cue.note != noteIndex) break;
    lyricIndex++;

    char text[LCD_COLS + 1];
    strncpy_P(text, cue.text, LCD_COLS);
    text[LCD_COLS] = '\0';
    showLyric(cue.mode, text);

    sendWithId(F("LYRIC"), meme.id);
    Serial.print(' ');
    Serial.print((const __FlashStringHelper*)MODE_NAMES[cue.mode]);
    Serial.print(' ');
    Serial.println((const __FlashStringHelper*)cue.text);
  }
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
  uint32_t freq = (uint32_t)n.freq << OCTAVE_SHIFT;   // 32-bit math: int is 16-bit on AVR
  if (freq) {
    tone(PIN_BUZZER, freq, (uint32_t)n.ms * 9 / 10);
  } else {
    noTone(PIN_BUZZER);
  }

  // NOTE <id> <index> <freq> <ms>: freq/ms let the page mirror the buzzer
  sendWithId(F("NOTE"), meme.id);
  Serial.print(' ');
  Serial.print(noteIndex);
  Serial.print(' ');
  Serial.print(freq);
  Serial.print(' ');
  Serial.println(n.ms);

  updateLyrics(meme);

  noteIndex++;
  nextNoteAt += n.ms;   // relative to previous target, not now, to avoid drift
}

// ---- Button ----

static void onPress(uint32_t now) {
  Serial.println(F("PRESS"));
  if (state == PLAYING) endMeme();   // second press stops and returns to idle
  else startMeme(current, now);
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

// ---- Serial commands (web to firmware) ----

static int8_t findMeme(const char* id) {
  if (!id) return -1;
  for (uint8_t i = 0; i < MEME_COUNT; i++) {
    if (!strcmp(MEMES[i].id, id)) return i;
  }
  return -1;
}

static void handleLine(char* line, uint32_t now) {
  char* arg = strchr(line, ' ');
  if (arg) *arg++ = '\0';

  if (!strcmp_P(line, PSTR("LIST"))) {
    sendMemes();
    sendMode();
    if (state == IDLE) sendIdle(now);   // page joining mid-pass
    return;
  }
  if (!strcmp_P(line, PSTR("PRESS"))) {
    onPress(now);
    return;
  }
  if (!strcmp_P(line, PSTR("STOP"))) {
    if (state == PLAYING) endMeme();
    return;
  }
  if (!strcmp_P(line, PSTR("PLAY"))) {
    int8_t i = findMeme(arg);
    if (i >= 0) {
      startMeme(i, now);
      return;
    }
  } else if (!strcmp_P(line, PSTR("MODE")) && arg) {
    if (!strcmp_P(arg, PSTR("single"))) { cycleMode = false; sendMode(); return; }
    if (!strcmp_P(arg, PSTR("cycle")))  { cycleMode = true;  sendMode(); return; }
  }

  // Unknown command or bad argument: log and ignore
  if (arg) arg[-1] = ' ';
  Serial.print(F("? "));
  Serial.println(line);
}

static void pollSerial(uint32_t now) {
  static char line[SERIAL_LINE_MAX + 1];
  static uint8_t len = 0;
  static bool overflow = false;

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[len] = '\0';
      if (overflow) Serial.println(F("? (line too long)"));
      else if (len) handleLine(line, now);
      len = 0;
      overflow = false;
    } else if (len < SERIAL_LINE_MAX) {
      line[len++] = c;
    } else {
      overflow = true;
    }
  }
}

void setup() {
  Serial.begin(BAUD);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_BUZZER, OUTPUT);

  lcd.begin(LCD_COLS, LCD_ROWS);

  Serial.print(F("READY "));
  Serial.println(FW_VERSION);
  sendMemes();
  sendMode();
  showIdle();   // after READY so the first IDLE line reaches a listening page
}

void loop() {
  uint32_t now = millis();
  pollButton(now);
  pollSerial(now);
  updatePlayer(now);
  updateLcd(now);
  updateIdle(now);
}
