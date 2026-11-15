#include "config.h"
#include "pitches.h"
#include "memes.h"

enum State : uint8_t { IDLE, PLAYING };

static State state = IDLE;
static uint8_t current = 0;       // index into MEMES
static uint16_t noteIndex = 0;
static uint32_t nextNoteAt = 0;
static uint16_t playCount = 0;

// ---- Protocol output (PLAN.md 3) ----

static void sendWithId(const __FlashStringHelper* tag, const char* id) {
  Serial.print(tag);
  Serial.print(' ');
  Serial.print(id);
}

// ---- Player ----

static void endMeme() {
  noTone(PIN_BUZZER);
  state = IDLE;
  sendWithId(F("END"), MEMES[current].id);
  Serial.println();
}

static void startMeme(uint8_t i, uint32_t now) {
  if (state == PLAYING) endMeme();
  current = i;
  state = PLAYING;
  noteIndex = 0;
  nextNoteAt = now;

  sendWithId(F("START"), MEMES[i].id);
  Serial.print(' ');
  Serial.println(MEMES[i].noteCount);
  Serial.print(F("COUNT "));
  Serial.println(++playCount);
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

  Serial.print(F("READY "));
  Serial.println(FW_VERSION);
}

void loop() {
  uint32_t now = millis();
  pollButton(now);
  // H4: pollSerial();
  updatePlayer(now);
  // H3: updateLcd(now);
}
