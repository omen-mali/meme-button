// Meme registry. Keys MUST match Meme.id in firmware/meme_button/memes.h.
// The page compares these keys with the firmware's MEMES line on connect.
export const MEMES = {
  rickroll: {
    title: "Never Gonna Give You Up",
    youtubeId: "dQw4w9WgXcQ",
    visual: "dance",            // CSS animation, works offline
  },
  // P3: one entry per firmware Meme, same key as Meme.id
};
