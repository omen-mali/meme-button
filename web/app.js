import { MEMES } from "./memes.js";
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
  stop: $("stopBtn"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  sound: $("soundToggle"),
  volume: $("volume"),
  video: $("videoToggle"),
  videoWrap: $("videoWrap"),
  videoFrame: $("videoFrame"),
  closeVideo: $("closeVideoBtn"),
  log: $("log"),
};

const IDLE_TITLE = "DO NOT PRESS";
const LOG_MAX = 200;
const READY_TIMEOUT_MS = 3000;   // board normally resets and sends READY within ~2 s

let boardReady = false;
let playing = null;               // { id, noteCount } while a melody runs
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
  playing = { id, noteCount };
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
  ui.dancer.classList.toggle("pose-b", index % 2 === 1);
  ui.progress.style.width = `${Math.min(100, ((index + 1) / playing.noteCount) * 100)}%`;
  ui.stage.animate([{ transform: "scale(1.02)" }, { transform: "scale(1)" }], { duration: 160 });
}

function endVisual() {
  playing = null;
  ui.stage.dataset.state = "idle";
  ui.title.textContent = IDLE_TITLE;
  ui.dancer.classList.remove("pose-b");
  ui.progress.style.width = "0%";
  clearLyrics();
}

function flashPress() {
  ui.press.animate([{ filter: "brightness(1.6)" }, { filter: "none" }], { duration: 250 });
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
    setMode("single");   // firmware boots in single mode
  },
  MEMES([list = ""]) {
    checkRegistry(list.split(",").filter(Boolean));
    if (!boardReady) markReady("Connected");
  },
  PRESS: flashPress,
  START([id, n]) {
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
  NEXT([id]) {
    ui.upNext.textContent = `Up next: ${memeInfo(id).title}`;
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
  const [cmd, ...args] = line.split(" ");
  if (Object.hasOwn(handlers, cmd)) handlers[cmd](args);
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
}

function onClose(lost) {
  boardReady = false;
  clearTimeout(readyTimer);
  endVisual();
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

function demoFeed(line) {
  onLine(line, "demo");
}

function demoPress() {
  const id = Object.keys(MEMES)[0];
  clearTimeout(demoTimer);
  demoFeed("PRESS");
  if (playing) demoFeed(`END ${playing.id}`);
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
    // No firmware confirmation for MODE in the protocol; UI reflects the request.
    setMode(b.dataset.mode);
    if (serial.isOpen()) send(`MODE ${b.dataset.mode}`);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.target.closest("input, button, select, textarea")) return;
  e.preventDefault();
  press();
});

if (!serial.isSupported()) {
  ui.connect.disabled = true;
  setStatus("lost", "Web Serial unavailable: use Chrome or Edge");
}
endVisual();
