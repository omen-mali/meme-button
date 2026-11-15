import {
  MEMES, IDLE_PREFIX, IDLE_WORDS, IDLE_WORD_MS, TAUNT_TEXT, ROLL_REDIRECT, ROLL_WATCHDOG_MS,
} from "./memes.js";
import * as serial from "./serial.js";

const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"),
  connect: $("connectBtn"),
  warning: $("warning"),
  stage: $("stage"),
  title: $("memeTitle"),
  dancer: $("dancer"),
  progress: $("progressBar"),
  upNext: $("upNext"),
  lyricPrev: $("lyricPrev"),
  lyricLine: $("lyricLine"),
  count: $("count"),
  press: $("pressBtn"),
  pointer: $("pointer"),
  idlePrefix: $("idlePrefix"),
  idleWord: $("idleWord"),
  stop: $("stopBtn"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  sound: $("soundToggle"),
  volume: $("volume"),
  video: $("videoToggle"),
  videoWrap: $("videoWrap"),
  videoFrame: $("videoFrame"),
  closeVideo: $("closeVideoBtn"),
  log: $("log"),
  rollOverlay: $("rollOverlay"),
  rollFrame: $("rollFrame"),
  closeRoll: $("closeRollBtn"),
  unmute: $("unmuteBtn"),
  fullscreenHint: $("fullscreenHint"),
  fullscreenBtn: $("fullscreenBtn"),
};

const LOG_MAX = 200;
const READY_TIMEOUT_MS = 3000;   // board normally resets and sends READY within ~2 s

let boardReady = false;
let playing = null;               // { id, noteCount, last } while a melody runs
let finishedId = null;            // set when the last melody played to the end, not stopped
let readyTimer = null;

// ---- Log ----

function log(dir, text) {
  const row = document.createElement("div");
  row.className = `log-${dir}`;
  row.textContent = `${{ in: "<", out: ">", demo: "~" }[dir]} ${text}`;
  ui.log.append(row);
  while (ui.log.childElementCount > LOG_MAX) ui.log.firstChild.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
}

function send(cmd) {
  log("out", cmd);
  serial.send(cmd);
}

// ---- Page audio: mirrors the buzzer from NOTE <id> <i> <freq> <ms> ----

let audio = null;

// Call from a user gesture so the AudioContext is allowed to start.
function ensureAudio() {
  audio ??= new AudioContext();
  if (audio.state === "suspended") audio.resume();
}

function playTone(freq, ms) {
  if (!audio || !ui.sound.checked || !freq || !ms) return;
  const t = audio.currentTime;
  const dur = (ms * 0.9) / 1000;   // same 90% gap as the firmware
  const level = (ui.volume.value / 100) * 0.15;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(level, t);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}

// ---- Visuals ----

function memeInfo(id) {
  return MEMES[id] ?? { title: id, visual: "dance" };
}

function startVisual(id, noteCount) {
  const meme = memeInfo(id);
  playing = { id, noteCount, last: -1 };
  ui.stage.dataset.state = "playing";
  ui.stage.dataset.visual = meme.visual;
  ui.title.textContent = meme.title;
  ui.progress.style.width = "0%";
  ui.upNext.textContent = "";
  clearLyrics();
}

function clearLyrics() {
  ui.lyricPrev.textContent = "";
  ui.lyricLine.textContent = "";
}

// mode: new = start a line, add = append after a space, cont = append (split word)
function showLyric(mode, text) {
  if (mode === "new") {
    ui.lyricPrev.textContent = ui.lyricLine.textContent;
    ui.lyricLine.textContent = text;
  } else {
    const line = ui.lyricLine.textContent;
    ui.lyricLine.textContent = line + (mode === "add" && line ? " " : "") + text;
  }
}

function stepVisual(index) {
  if (!playing) return;
  playing.last = index;
  ui.dancer.classList.toggle("pose-b", index % 2 === 1);
  ui.progress.style.width = `${Math.min(100, ((index + 1) / playing.noteCount) * 100)}%`;
  ui.stage.animate([{ transform: "scale(1.02)" }, { transform: "scale(1)" }], { duration: 160 });
}

function endVisual() {
  finishedId = playing && playing.last >= playing.noteCount - 1 ? playing.id : null;
  playing = null;
  ui.upNext.textContent = "";
  ui.stage.dataset.state = "idle";
  ui.title.textContent = "";
  ui.dancer.classList.remove("pose-b");
  ui.progress.style.width = "0%";
  clearLyrics();
}

function flashPress() {
  (ui.press.hidden ? ui.pointer : ui.press).animate([{ filter: "brightness(1.6)" }, { filter: "none" }], { duration: 250 });
}

// ---- Idle text: static line, last word swaps in place ----

let localIdleTimer = null;
let localWord = 0;
let wordSlot = Math.max(...IDLE_WORDS.map((w) => w.length));

function renderIdle(text) {
  const cut = text.lastIndexOf(" ") + 1;
  const word = text.slice(cut);
  // Reserve the longest word's width so the line never shifts when the word changes
  wordSlot = Math.max(wordSlot, word.length);
  ui.idleWord.style.minWidth = `calc(${wordSlot}ch + ${wordSlot * 0.05}em)`;   // + letter-spacing
  ui.idlePrefix.textContent = text.slice(0, cut);
  ui.idleWord.textContent = word;
}

// No board: rotate through the page's own copy of the words.
function startLocalIdle() {
  stopLocalIdle();
  const next = () => {
    renderIdle(IDLE_PREFIX + IDLE_WORDS[localWord]);
    localWord = (localWord + 1) % IDLE_WORDS.length;
    localIdleTimer = setTimeout(next, IDLE_WORD_MS);
  };
  next();
}

function stopLocalIdle() {
  clearTimeout(localIdleTimer);
  localIdleTimer = null;
}

// ---- Demo sequence: taunt (2nd press) and roll (3rd press) ----

function showTaunt(text) {
  ui.stage.dataset.screen = "taunt";
  ui.title.textContent = text;
}

function clearTaunt() {
  delete ui.stage.dataset.screen;
}

// Roll video. Chrome only autoplays with sound when the page has had a user gesture
// (Connect) and the window is visible, and a plain embed can't report a refusal.
// The YouTube player API is created once up front, so a roll only has to press play,
// and a blocked start falls back to muted playback plus a "tap for sound" button.

let ytPlayer = null;   // YT.Player once the API is ready
let rollWatchdog = null;

function loadYouTubePlayer() {
  window.onYouTubeIframeAPIReady = () => {
    const player = new YT.Player("rollPlayer", {
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: { rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          ytPlayer = player;
          const first = MEMES[Object.keys(MEMES)[0]]?.youtubeId;
          if (first) player.cueVideoById(first);   // warm up: the first roll starts faster
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) clearTimeout(rollWatchdog);
        },
        onAutoplayBlocked: () => {
          console.info("autoplay with sound blocked; playing muted");
          playMuted();
        },
      },
    });
  };
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.onerror = () => console.warn("YouTube player API unavailable; using a plain embed");
  document.head.append(script);
}

function rollPlaying() {
  const state = ytPlayer?.getPlayerState();
  return state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING;
}

function playMuted() {
  if (ui.rollOverlay.hidden || !ytPlayer) return;
  ytPlayer.mute();
  ytPlayer.playVideo();
  ui.unmute.hidden = false;
}

// Needs a gesture: click, tap or key press
function unmuteRoll() {
  if (!ytPlayer) return;
  ytPlayer.unMute();
  ytPlayer.playVideo();
  ui.unmute.hidden = true;
}

function openRoll(id) {
  const yt = MEMES[id]?.youtubeId;
  if (!yt) return;
  if (ROLL_REDIRECT) {
    location.assign(`https://www.youtube.com/watch?v=${yt}`);
    return;
  }
  ui.rollOverlay.hidden = false;
  ui.unmute.hidden = true;
  if (ytPlayer) {
    ytPlayer.unMute();
    ytPlayer.loadVideoById(yt);
    clearTimeout(rollWatchdog);
    rollWatchdog = setTimeout(() => {
      if (!rollPlaying()) {
        console.info("video not playing after", ROLL_WATCHDOG_MS, "ms; playing muted");
        playMuted();
      }
    }, ROLL_WATCHDOG_MS);
  } else {
    ui.rollFrame.src = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&playsinline=1`;
    ui.rollFrame.hidden = false;
  }
  // Page already fullscreen: the overlay fills the screen as is. Otherwise this only
  // works inside a user gesture (Space / on-screen press); a physical press arrives
  // over serial, so the overlay just fills the window.
  if (!document.fullscreenElement) ui.rollOverlay.requestFullscreen?.().catch(() => {});
}

function closeRoll() {
  if (ui.rollOverlay.hidden) return;
  clearTimeout(rollWatchdog);
  ytPlayer?.stopVideo();
  ui.rollFrame.src = "about:blank";
  ui.rollFrame.hidden = true;
  ui.unmute.hidden = true;
  ui.rollOverlay.hidden = true;
  if (document.fullscreenElement === ui.rollOverlay) document.exitFullscreen().catch(() => {});
}

// ---- Fullscreen hint: shown until the page or the browser is fullscreen ----

function isFullscreen() {
  if (document.fullscreenElement) return true;
  // Browser fullscreen (⌃⌘F, F11) doesn't set fullscreenElement; the viewport fills the screen instead
  return window.innerWidth >= screen.width - 2 && window.innerHeight >= screen.height - 2;
}

function updateFullscreenHint() {
  ui.fullscreenHint.hidden = isFullscreen();
}

function showConnectedControls(connected) {
  ui.press.hidden = connected;     // the real button takes over
  ui.pointer.hidden = !connected;
}

function maybeStartVideo(id) {
  const yt = MEMES[id]?.youtubeId;
  if (!ui.video.checked || !yt || ui.videoFrame.dataset.yt === yt) return;
  ui.videoFrame.src = `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1`;
  ui.videoFrame.dataset.yt = yt;
  ui.videoWrap.hidden = false;
}

function closeVideo() {
  ui.videoFrame.src = "about:blank";
  ui.videoFrame.dataset.yt = "";
  ui.videoWrap.hidden = true;
}

function setMode(mode) {
  for (const b of ui.modeButtons) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
}

function checkRegistry(firmwareIds) {
  const pageIds = Object.keys(MEMES);
  const missingOnPage = firmwareIds.filter((id) => !pageIds.includes(id));
  const missingOnBoard = pageIds.filter((id) => !firmwareIds.includes(id));
  if (!missingOnPage.length && !missingOnBoard.length) {
    ui.warning.hidden = true;
    return;
  }
  const parts = [];
  if (missingOnPage.length) parts.push(`board has ${missingOnPage.join(", ")} but memes.js does not`);
  if (missingOnBoard.length) parts.push(`memes.js has ${missingOnBoard.join(", ")} but the board does not`);
  ui.warning.textContent = `Meme registry mismatch: ${parts.join("; ")}.`;
  ui.warning.hidden = false;
}

// ---- Firmware to web ----

const handlers = {
  READY([version]) {
    markReady(`Connected · fw ${version ?? "?"}`);
  },
  MODE([mode]) {
    setMode(mode);
  },
  IDLE([, , ...words]) {   // IDLE <wordMs> <elapsedMs> <text>
    stopLocalIdle();
    clearTaunt();
    renderIdle(words.join(" "));
  },
  MEMES([list = ""]) {
    checkRegistry(list.split(",").filter(Boolean));
    if (!boardReady) markReady("Connected");
  },
  PRESS: flashPress,
  START([id, n]) {
    closeRoll();
    clearTaunt();
    startVisual(id, Number(n) || 1);
    maybeStartVideo(id);
  },
  NOTE([, i, freq, ms]) {
    stepVisual(Number(i));
    playTone(Number(freq), Number(ms));
  },
  LYRIC([, mode, ...words]) {
    showLyric(mode, words.join(" "));
  },
  END: endVisual,
  TAUNT(words) {
    showTaunt(words.join(" "));
  },
  ROLL([id]) {
    clearTaunt();
    openRoll(id);
  },
  NEXT([id]) {
    // Only after a melody finished on its own, and only if it's a different meme
    if (finishedId && id !== finishedId) ui.upNext.textContent = `Up next: ${memeInfo(id).title}`;
  },
  COUNT([n]) {
    ui.count.textContent = n;
  },
  VOL([v]) {
    ui.volume.value = Number(v) * 10;
  },
};

function onLine(line, source = "in") {
  log(source, line);
  const [first, ...args] = line.split(" ");
  // The UNO can emit a stray byte while resetting, e.g. "pREADY 0.7"
  const cmd = Object.hasOwn(handlers, first) ? first : Object.keys(handlers).find((k) => first.endsWith(k));
  if (cmd) handlers[cmd](args);
  else console.warn("unhandled line:", line);
}

// ---- Connection ----

function setStatus(kind, text) {
  ui.status.dataset.kind = kind;
  ui.status.textContent = text;
}

function markReady(text) {
  boardReady = true;
  clearTimeout(readyTimer);
  setStatus("connected", text);
  showConnectedControls(true);
}

function onClose(lost) {
  boardReady = false;
  clearTimeout(readyTimer);
  endVisual();
  showConnectedControls(false);
  startLocalIdle();
  ui.connect.textContent = lost ? "Reconnect" : "Connect";
  if (lost) setStatus("lost", "Connection lost");
  else setStatus("idle", "Not connected");
}

async function onConnectClick() {
  ensureAudio();
  if (serial.isOpen()) {
    await serial.disconnect();
    return;
  }
  demoStop();
  setStatus("connecting", "Connecting… board is resetting");
  try {
    await serial.connect({ onLine, onClose });
  } catch (err) {
    if (err.name === "NotFoundError") setStatus("idle", "Not connected");   // picker cancelled
    else setStatus("lost", "Port busy? Close Serial Monitor / make monitor");
    console.warn(err);
    return;
  }
  ui.connect.textContent = "Disconnect";
  // Some boards don't reset on open, so READY never comes: ask directly.
  readyTimer = setTimeout(() => { if (!boardReady) send("LIST"); }, READY_TIMEOUT_MS);
}

// ---- Demo fallback: simulates the firmware when no board is connected ----

// Generic arpeggio for the demo only; real melodies live in firmware.
const DEMO_NOTES = [[523, 150], [659, 150], [784, 150], [1047, 300], [0, 100], [784, 150], [1047, 450]];
let demoTimer = null;
let demoCount = 0;
let demoStep = 0;   // mirrors the firmware's press sequence

function demoFeed(line) {
  onLine(line, "demo");
}

function demoPress() {
  const id = Object.keys(MEMES)[0];
  clearTimeout(demoTimer);
  demoFeed("PRESS");
  const seq = demoStep;
  demoStep = (demoStep + 1) % 3;
  if (seq === 1) {
    if (playing) demoFeed(`END ${playing.id}`);
    demoFeed(`TAUNT ${TAUNT_TEXT}`);
    return;
  }
  if (seq === 2) {
    demoFeed(`ROLL ${id}`);
    return;
  }
  demoFeed(`START ${id} ${DEMO_NOTES.length}`);
  demoFeed(`COUNT ${++demoCount}`);
  let i = 0;
  const step = () => {
    if (i === DEMO_NOTES.length) {
      demoFeed(`END ${id}`);
      return;
    }
    const [freq, ms] = DEMO_NOTES[i];
    demoFeed(`NOTE ${id} ${i} ${freq} ${ms}`);
    i++;
    demoTimer = setTimeout(step, ms);
  };
  step();
}

function demoStop() {
  clearTimeout(demoTimer);
  if (playing) demoFeed(`END ${playing.id}`);
}

// ---- Controls ----

function press() {
  ensureAudio();
  if (serial.isOpen()) send("PRESS");
  else demoPress();
}

function stop() {
  if (serial.isOpen()) send("STOP");
  else demoStop();
  closeVideo();
}

ui.connect.addEventListener("click", onConnectClick);
ui.press.addEventListener("click", press);
ui.stop.addEventListener("click", stop);
ui.closeVideo.addEventListener("click", closeVideo);
for (const b of ui.modeButtons) {
  b.addEventListener("click", () => {
    // Connected: the firmware's MODE reply updates the buttons
    if (serial.isOpen()) send(`MODE ${b.dataset.mode}`);
    else setMode(b.dataset.mode);
  });
}

ui.closeRoll.addEventListener("click", closeRoll);
ui.fullscreenBtn.addEventListener("click", () => {
  document.documentElement.requestFullscreen?.().catch((err) => console.warn("fullscreen refused:", err));
});
window.addEventListener("resize", updateFullscreenHint);
document.addEventListener("fullscreenchange", updateFullscreenHint);

ui.unmute.addEventListener("click", unmuteRoll);

// Chrome holds back playback while the window is hidden or covered; retry when it shows
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !ui.rollOverlay.hidden && ytPlayer && !rollPlaying()) {
    ytPlayer.playVideo();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRoll();
  if (!ui.unmute.hidden && e.key !== "Escape") {   // any key while muted: unmute, don't press
    e.preventDefault();
    unmuteRoll();
    return;
  }
  if (e.code !== "Space" || e.repeat || e.target.closest("input, button, select, textarea")) return;
  e.preventDefault();
  press();
});

if (!serial.isSupported()) {
  ui.connect.disabled = true;
  setStatus("lost", "Web Serial unavailable: use Chrome or Edge");
}
endVisual();
startLocalIdle();
updateFullscreenHint();
loadYouTubePlayer();
