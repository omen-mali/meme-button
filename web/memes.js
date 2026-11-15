// Meme registry. Keys MUST match Meme.id in firmware/meme_button/memes.h.
// The page compares these keys with the firmware's MEMES line on connect.
export const MEMES = {
  rickroll: {
    title: "GET RICKROLLED!",
    youtubeId: "dQw4w9WgXcQ",
    visual: "dance",            // CSS animation, works offline
  },
  // P3: one entry per firmware Meme, same key as Meme.id
};

// Idle text shown when no board is connected. Mirrors IDLE_PREFIX / IDLE_WORDS in
// meme_button.ino and IDLE_WORD_MS in config.h; once connected,
// the firmware's IDLE lines drive it instead.
export const IDLE_PREFIX = "PRESS FOR FREE ";
export const IDLE_WORDS = ["FOOD", "MONEY", "VBUCKS", "PIZZA", "CANDY", "WIFI"];
export const IDLE_WORD_MS = 3000;
