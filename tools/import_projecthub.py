#!/usr/bin/env python3
"""Convert the Arduino Project Hub "Rickroll Piezo Buzzer" sketch (Rowan Packard)
into firmware/meme_button/song_rickroll.h: melody + lyric cues in PROGMEM.

The input is your own saved copy of that sketch. The output is git-ignored:
the song's melody and lyrics belong to their rights holders, so they stay local.

Usage: python3 -I tools/import_projecthub.py songs/rickroll_projecthub.ino
"""
import argparse
import re
import sys
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "firmware/meme_button/song_rickroll.h"

# section name -> (array prefix in the source, lyrics array or None)
SECTIONS = {
    "intro": ("song1_intro", None),
    "verse": ("song1_verse1", "lyrics_verse1"),
    "chorus": ("song1_chorus", "lyrics_chorus"),
}

ASCII_FIXES = {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-"}


def strip_comments(src):
    # Keep string literals intact; drop // and /* */ comments
    pattern = r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*.*?\*/'
    return re.sub(pattern, lambda m: m.group(0) if m.group(0).startswith('"') else "", src, flags=re.S)


def c_unescape(s):
    # Backslash-newline is a C line splice, but pages copied from Project Hub show
    # "\n" that way, so it is read as the line break the author meant.
    table = {"n": "\n", "\n": "\n", "t": " ", "r": "", "\\": "\\", '"': '"', "'": "'"}
    return re.sub(r"\\(.)", lambda m: table.get(m.group(1), m.group(1)), s, flags=re.S)


def c_escape(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def parse(src):
    src = strip_comments(src)
    defines = {k: int(v) for k, v in re.findall(r"^\s*#define\s+(\w+)\s+(-?\d+)\b", src, re.M)}
    ints, strings = {}, {}
    for name, body in re.findall(r"\b(\w+)\s*\[\s*\d*\s*\]\s*=\s*\{(.*?)\}\s*;", src, re.S):
        if '"' in body:
            strings[name] = [c_unescape(s) for s in re.findall(r'"((?:\\.|[^"\\])*)"', body, re.S)]
        else:
            vals = []
            for tok in filter(None, (t.strip() for t in body.split(","))):
                if re.fullmatch(r"-?\d+", tok):
                    vals.append(int(tok))
                elif tok in defines:
                    vals.append(defines[tok])
                else:
                    sys.exit(f"error: unknown token {tok!r} in {name}")
            ints[name] = vals
    beat_m = re.search(r"\bbeatlength\s*=\s*(\d+)", src)
    if not beat_m:
        if "melody" in ints and re.search(r"\btempo\s*=", src):
            sys.exit("error: this looks like the arduino-songs sketch (int melody[] + tempo), "
                     "not the Project Hub one. Paste the code from the Project Hub page instead.")
        sys.exit("error: no 'beatlength = <n>' found; is this the Project Hub Rickroll sketch?")
    beat = int(beat_m.group(1))
    sep_m = re.search(r"\bbeatseparationconstant\s*=\s*([\d.]+)", src)
    sep = float(sep_m.group(1)) if sep_m else 0.0
    return ints, strings, beat, sep, src


def section_factor(src, prefix):
    # e.g. "notelength = beatlength * 2 * song1_verse1_rhythmn[b];" -> 2
    m = re.search(rf"beatlength\s*(?:\*\s*(\d+)\s*)?\*\s*{prefix}_rhythmn", src)
    return int(m.group(1)) if m and m.group(1) else 1


def to_ascii(s):
    for k, v in ASCII_FIXES.items():
        s = s.replace(k, v)
    return s.encode("ascii", "ignore").decode()


def build(ints, strings, beat, sep, src, order):
    notes, cues = [], []
    for name in order:
        prefix, lyric_name = SECTIONS[name]
        melody, rhythm = ints.get(f"{prefix}_melody"), ints.get(f"{prefix}_rhythmn")
        if melody is None or rhythm is None:
            sys.exit(f"error: {prefix}_melody / {prefix}_rhythmn not found")
        if len(melody) != len(rhythm):
            sys.exit(f"error: {name}: {len(melody)} notes but {len(rhythm)} rhythm values")
        lyrics = strings.get(lyric_name) if lyric_name else None
        sounded = sum(1 for f in melody if f > 0)
        if lyrics is not None and len(lyrics) != sounded:
            sys.exit(f"error: {name}: {sounded} sounded notes but {len(lyrics)} lyric chunks")

        factor = section_factor(src, prefix)
        pending_new = True    # each section starts a new lyric line
        prev_spaced = True    # last non-empty chunk ended with a space
        li = 0
        for freq, beats in zip(melody, rhythm):
            # Source: tone for notelength, then silence for notelength * sep.
            # Here the whole slot is one entry; the firmware sounds 90% of it.
            ms = round(beat * factor * beats * (1 + sep))
            index = len(notes)
            notes.append((max(freq, 0), ms))
            if freq <= 0 or lyrics is None:
                continue
            raw = to_ascii(lyrics[li])
            li += 1
            starts_break = raw.lstrip(" ").startswith("\n")
            ends_break = raw.rstrip(" ").endswith("\n")
            text = " ".join(raw.replace("\n", " ").split())
            if text:
                if pending_new or starts_break:
                    mode = "LYRIC_NEW"
                elif prev_spaced or raw.startswith(" "):
                    mode = "LYRIC_ADD"
                else:
                    mode = "LYRIC_CONT"
                cues.append((index, mode, text))
                pending_new = False
                prev_spaced = raw.endswith(" ") or raw.endswith("\n")
            if ends_break:
                pending_new = True
    return notes, cues


def render(notes, cues, source_name):
    out = [
        "#pragma once",
        f"// Generated by tools/import_projecthub.py from {source_name}. Git-ignored: do not commit.",
        "// Arrangement: Rowan Packard, Arduino Project Hub \"Rickroll Piezo Buzzer\".",
        "// Song: \"Never Gonna Give You Up\" (Rick Astley); rights belong to their owners.",
        "",
        "const Note MELODY_RICKROLL[] PROGMEM = {",
    ]
    for i in range(0, len(notes), 8):
        out.append("  " + " ".join(f"{{{f}, {ms}}}," for f, ms in notes[i:i + 8]))
    out += ["};", "const uint16_t MELODY_RICKROLL_COUNT = sizeof(MELODY_RICKROLL) / sizeof(Note);", ""]
    for i, (_, _, text) in enumerate(cues):
        out.append(f'const char LYRIC_RICKROLL_{i}[] PROGMEM = "{c_escape(text)}";')
    out += ["", "const LyricCue LYRICS_RICKROLL[] PROGMEM = {"]
    for i, (note, mode, _) in enumerate(cues):
        out.append(f"  {{{note}, {mode}, LYRIC_RICKROLL_{i}}},")
    out += ["};", "const uint16_t LYRICS_RICKROLL_COUNT = sizeof(LYRICS_RICKROLL) / sizeof(LyricCue);", ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="saved copy of the Project Hub sketch")
    ap.add_argument("-o", "--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--sections", default="intro,verse,chorus",
                    help="comma-separated play order from: " + ",".join(SECTIONS))
    args = ap.parse_args()

    order = [s.strip() for s in args.sections.split(",") if s.strip()]
    if unknown := [s for s in order if s not in SECTIONS]:
        sys.exit(f"error: unknown section(s) {unknown}")

    notes, cues = build(*parse(args.source.read_text(encoding="utf-8")), order)
    args.out.write_text(render(notes, cues, args.source.name), encoding="ascii")

    total_s = sum(ms for _, ms in notes) / 1000
    longest = max((len(t) for _, _, t in cues), default=0)
    print(f"wrote {args.out}: {len(notes)} notes, {len(cues)} lyric cues, "
          f"{total_s:.1f} s, longest chunk {longest} chars", file=sys.stderr)
    if longest > 16:
        print("warning: chunks over 16 chars are cut off on the LCD", file=sys.stderr)


if __name__ == "__main__":
    main()
