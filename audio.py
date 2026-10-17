"""Synthesize the soundtrack: 120 BPM synthwave groove + SFX placed on the timeline cues.

usage: python3 audio.py cues.json soundtrack.wav
"""
import json
import sys
import wave

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 44100
DUR = 72.0
BPM = 120
BEAT = 60 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(7)


def t_axis(d):
    return np.arange(int(d * SR)) / SR


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    n = min(len(sig), len(buf) - i)
    buf[i:i + n] += sig[:n] * gain


def lp(x, fc, order=2):
    return sosfilt(butter(order, min(fc, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc / (SR / 2), 'high', output='sos'), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo / (SR / 2), hi / (SR / 2)], 'band', output='sos'), x)


def sweep_lp(x, f0, f1):
    """one-pole low-pass with exponentially sweeping cutoff, processed in blocks"""
    out = np.zeros_like(x)
    zi = np.zeros(1)
    blk = 256
    nb = max(1, len(x) // blk + 1)
    for b in range(nb):
        s = x[b * blk:(b + 1) * blk]
        if not len(s):
            break
        f = f0 * (f1 / f0) ** (b / nb)
        a = np.exp(-2 * np.pi * f / SR)
        y, zi = lfilter([1 - a], [1, -a], s, zi=zi)
        out[b * blk:b * blk + len(s)] = y
    return out


def env(n, a=0.005, d=0.2, s=0.0, r=0.05, hold=None):
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-6)))
    if hold is not None:
        rel = t > hold
        e[rel] *= np.exp(-(t[rel] - hold) / max(r, 1e-6))
    return e


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def saw(f, t, detune=0.0):
    ph = (f * (1 + detune)) * t
    return 2 * (ph - np.floor(ph + 0.5))


# ------------------------------------------------------------- instruments
def kick(v=1.0):
    t = t_axis(0.45)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 7.5)
    s += 0.25 * hp(rng.standard_normal(len(t)), 2000) * np.exp(-t * 120)
    return np.tanh(s * 1.6) * v


def clap(v=1.0):
    t = t_axis(0.3)
    n = bp(rng.standard_normal(len(t)), 900, 5000)
    e = np.exp(-t * 22)
    for off in (0.0, 0.011, 0.022):
        i = int(off * SR)
        e[i:] += 0.6 * np.exp(-(t[:len(t) - i]) * 60)
    return n * e * 0.5 * v


def hat(v=1.0, open_=False):
    t = t_axis(0.25 if open_ else 0.06)
    n = hp(rng.standard_normal(len(t)), 7000, 4)
    return n * np.exp(-t * (14 if open_ else 70)) * 0.35 * v


def bass_note(f, d, v=1.0):
    t = t_axis(d)
    s = saw(f, t) + 0.6 * saw(f, t, 0.006) + 0.8 * np.sin(2 * np.pi * f / 2 * t)
    s = sweep_lp(s, 1400, 260)
    return s * env(len(t), 0.004, d * 0.7, 0.4, 0.03, hold=d * 0.85) * 0.32 * v


def pluck(f, d=0.25, v=1.0):
    t = t_axis(d + 0.2)
    s = saw(f, t) * 0.6 + saw(f, t, 0.008) * 0.6 + np.sign(np.sin(2 * np.pi * f * t)) * 0.25
    s = sweep_lp(s, 6000, 700)
    return s * env(len(t), 0.002, 0.12, 0.0) * 0.16 * v


def pad_chord(notes, d, v=1.0):
    t = t_axis(d + 0.6)
    s = np.zeros(len(t))
    for n in notes:
        f = midi(n)
        for dt in (-0.007, 0.0, 0.0065):
            s += saw(f, t, dt)
    s = lp(s / (len(notes) * 3), 1800)
    a = np.minimum(1, t / 0.35) * np.where(t > d, np.exp(-(t - d) / 0.25), 1)
    return s * a * 0.22 * v


# ------------------------------------------------------------- sfx
def sfx_impact(v):
    t = t_axis(2.2)
    f = 38 + 70 * np.exp(-t * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    crash = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 3.5) * 0.35
    body = lp(rng.standard_normal(len(t)), 600) * np.exp(-t * 9) * 0.8
    return np.tanh((boom * 1.4 + crash + body) * 1.2) * 0.75 * v


def sfx_whoosh(v, d=0.5):
    t = t_axis(d + 0.15)
    n = rng.standard_normal(len(t))
    s = sweep_lp(n, 300, 7000)
    e = np.sin(np.pi * np.clip(t / (d + 0.15), 0, 1)) ** 2
    return s * e * 0.55 * v


def sfx_riser(v, d=1.0):
    t = t_axis(d)
    n = sweep_lp(rng.standard_normal(len(t)), 200, 9000) * 0.6
    f = 200 * (8 ** (t / d))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    e = (t / d) ** 2.2
    return (n + tone) * e * 0.6 * v


def sfx_pop(v):
    t = t_axis(0.12)
    f = 500 + 1400 * (1 - np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38) * 0.35 * v


def sfx_tick(v):
    t = t_axis(0.15)
    s = np.sin(2 * np.pi * 1760 * t) * 0.6 + np.sin(2 * np.pi * 2640 * t) * 0.3
    return s * np.exp(-t * 35) * 0.28 * v


def sfx_error(v):
    t = t_axis(0.22)
    s = np.sign(np.sin(2 * np.pi * 110 * t)) * 0.5 + np.sign(np.sin(2 * np.pi * 116 * t)) * 0.5
    return lp(s, 2500) * np.exp(-t * 12) * 0.22 * v


def sfx_glitch(v, d=0.25):
    t = t_axis(d)
    s = np.zeros(len(t))
    seg = int(SR * 0.018)
    for i in range(0, len(t), seg):
        kind = rng.integers(0, 3)
        tt = t[i:i + seg]
        if kind == 0:
            s[i:i + seg] = np.sign(np.sin(2 * np.pi * rng.uniform(80, 1500) * tt))
        elif kind == 1:
            s[i:i + seg] = rng.standard_normal(len(tt))
        else:
            s[i:i + seg] = 0
    s = np.round(s * 4) / 4
    return lp(s, 6000) * 0.22 * v


def sfx_coin(v):
    t = t_axis(0.35)
    s = np.sin(2 * np.pi * 1975 * t) * (t < 0.07) + np.sin(2 * np.pi * 2637 * t) * (t >= 0.07)
    return s * np.exp(-t * 9) * 0.2 * v


def sfx_lock(v):
    t = t_axis(0.25)
    c1 = hp(rng.standard_normal(len(t)), 1500) * np.exp(-t * 90)
    c2 = np.zeros(len(t))
    i = int(0.07 * SR)
    c2[i:] = hp(rng.standard_normal(len(t) - i), 800) * np.exp(-t[:len(t) - i] * 60)
    thud = np.sin(2 * np.pi * 90 * t) * np.exp(-t * 25)
    return (c1 * 0.5 + c2 * 0.6 + thud * 0.6) * 0.6 * v


def sfx_stamp(v):
    t = t_axis(0.6)
    thud = np.sin(2 * np.pi * (60 + 80 * np.exp(-t * 30)) * t) * np.exp(-t * 9)
    slap = bp(rng.standard_normal(len(t)), 300, 3000) * np.exp(-t * 30)
    return np.tanh((thud + slap) * 1.5) * 0.7 * v


def sfx_land(v):
    t = t_axis(0.35)
    return (np.sin(2 * np.pi * (50 + 60 * np.exp(-t * 25)) * t) * np.exp(-t * 12)
            + lp(rng.standard_normal(len(t)), 400) * np.exp(-t * 25) * 0.6) * 0.6 * v


def sfx_type(v, d=0.6):
    out = np.zeros(int((d + 0.05) * SR))
    k = 0.0
    while k < d:
        c = hp(rng.standard_normal(int(0.012 * SR)), 2500) * np.exp(-np.arange(int(0.012 * SR)) / SR * 400)
        add(out, k, c, 0.14 * v * rng.uniform(0.6, 1.0))
        k += rng.uniform(0.035, 0.07)
    return out


def sfx_chime(v):
    t = t_axis(1.4)
    s = np.zeros(len(t))
    for j, n in enumerate((81, 88, 93)):
        tt = np.clip(t - j * 0.06, 0, None)
        s += np.sin(2 * np.pi * midi(n) * tt) * np.exp(-tt * 3.5) * (t >= j * 0.06)
    return s * 0.12 * v


def sfx_shimmer(v, d=1.5):
    t = t_axis(d)
    s = np.zeros(len(t))
    for n in (76, 81, 84, 88, 93, 96):
        s += np.sin(2 * np.pi * midi(n) * t + rng.uniform(0, 6)) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(3, 9) * t))
    e = np.sin(np.pi * t / d)
    return s * e * 0.035 * v


def sfx_zap(v, d=0.5):
    t = t_axis(d)
    s = np.sign(np.sin(2 * np.pi * (90 + 40 * np.sin(2 * np.pi * 30 * t)) * t))
    s += rng.standard_normal(len(t)) * 0.5
    return lp(s, 3500) * np.exp(-t * 4) * 0.25 * v


def sfx_scan(v, d=1.5):
    t = t_axis(d)
    f = 700 + 500 * np.sin(2 * np.pi * 1.4 * t)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR)
    return s * (0.5 + 0.5 * np.sin(2 * np.pi * 12 * t)) * np.sin(np.pi * t / d) * 0.05 * v


def sfx_scribble(v, d=0.5):
    t = t_axis(d)
    s = bp(rng.standard_normal(len(t)), 1500, 6000) * (0.4 + 0.6 * np.abs(np.sin(2 * np.pi * 7 * t)))
    return s * np.sin(np.pi * t / d) * 0.12 * v


SFX = {
    'impact': sfx_impact, 'drop': sfx_impact, 'whoosh': sfx_whoosh, 'riser': sfx_riser, 'pop': sfx_pop,
    'tick': sfx_tick, 'error': sfx_error, 'glitch': sfx_glitch, 'coin': sfx_coin, 'lock': sfx_lock,
    'stamp': sfx_stamp, 'land': sfx_land, 'type': sfx_type, 'chime': sfx_chime, 'shimmer': sfx_shimmer,
    'zap': sfx_zap, 'scan': sfx_scan, 'scribble': sfx_scribble,
}
DUR_SFX = {'whoosh', 'riser', 'glitch', 'type', 'shimmer', 'zap', 'scan', 'scribble'}


# ------------------------------------------------------------- arrangement
def section(t):
    """which layers play at time t"""
    if t < 3.0:
        return set()
    if t < 15.25:
        return {'kick', 'hat', 'clap', 'bass', 'arp'}
    if t < 18.0:
        return {'kick', 'hat', 'clap', 'bass', 'dark'}
    if t < 25.0:
        return {'kick', 'hat', 'bass'}
    if t < 64.0:
        return {'kick', 'hat', 'clap', 'bass', 'arp', 'ohat'}
    if t < 67.5:
        return set()
    if t < 71.5:
        return {'kick', 'hat', 'clap', 'bass', 'arp', 'ohat'}
    return set()


# Am  F  C  G (one chord per bar), root notes in MIDI
CHORDS = [(57, [57, 60, 64]), (53, [53, 57, 60]), (48, [48, 52, 55]), (55, [55, 59, 62])]


def build(cues):
    drums = np.zeros(N)
    music = np.zeros(N)
    fx = np.zeros(N)
    side = np.ones(N)  # sidechain gain from kick

    bar = 4 * BEAT
    nbars = int(DUR / bar) + 1
    for b in range(nbars):
        t0 = b * bar
        root, triad = CHORDS[b % 4]
        # pad always (except very end), louder in breakdown
        pad_v = 1.4 if 64 <= t0 < 67.5 else (0.6 if t0 < 3 else 0.9)
        if t0 < 71.5:
            add(music, t0, pad_chord([n + 12 for n in triad] + [triad[0]], bar, pad_v))
        for s16 in range(16):
            t = t0 + s16 * BEAT / 4
            L = section(t + 1e-4)
            if s16 % 4 == 0 and 'kick' in L:
                add(drums, t, kick(1.0))
                i = int(t * SR)
                n = int(0.32 * SR)
                if i < N:
                    dip = 1 - 0.65 * np.exp(-np.arange(min(n, N - i)) / SR * 9)
                    side[i:i + len(dip)] = np.minimum(side[i:i + len(dip)], dip)
            if s16 in (4, 12) and 'clap' in L:
                add(drums, t, clap(0.9))
            if s16 % 4 == 2 and 'hat' in L:
                add(drums, t, hat(1.0))
            if s16 % 2 == 1 and 'hat' in L:
                add(drums, t, hat(0.45))
            if s16 % 8 == 6 and 'ohat' in L:
                add(drums, t, hat(0.6, True))
            if s16 % 2 == 0 and 'bass' in L:
                oct_up = 12 if s16 % 4 == 2 else 0
                add(music, t, bass_note(midi(root - 24 + oct_up), BEAT / 2 * 0.95, 1.15 if 'dark' in L else 1.0))
            if 'arp' in L:
                pattern = [0, 1, 2, 3, 2, 1, 0, 2]
                notes = triad + [triad[0] + 12]
                n = notes[pattern[s16 % 8]] + 12
                add(music, t, pluck(midi(n), BEAT / 4, 1.0))
    # intro/outro bass swells on the drops
    for td in (3.0, 25.0, 67.5):
        add(music, td, bass_note(midi(33), 1.5, 1.4))

    for c in cues:
        f = SFX.get(c['type'])
        if not f:
            continue
        v = float(c.get('v', 1))
        sig = f(v, c.get('dur', 0.5)) if c['type'] in DUR_SFX else f(v)
        start = c['t']
        if c['type'] == 'riser':
            start = c['t']  # rises up to t + dur
        add(fx, start, sig)

    # simple stereo: delay on music/arp for width, short room on fx
    music = music * side
    dl = int(0.375 * SR)
    wet = np.zeros(N)
    wet[dl:] = music[:-dl] * 0.25
    wet2 = np.zeros(N)
    wet2[dl * 2:] = music[:-dl * 2] * 0.12
    left = drums + music + wet + fx
    right = drums + music + wet2 + fx
    rev = lp(fx, 3000)
    for d, g in ((0.031, 0.25), (0.047, 0.2), (0.071, 0.15), (0.113, 0.1)):
        k = int(d * SR)
        left[k:] += rev[:-k] * g
        right[k + 37:] += rev[:-(k + 37)] * g
    st = np.stack([left, right], 1)
    st = hp(st.T, 25).T
    st = np.tanh(st * 1.15)
    # fades
    fi = int(0.05 * SR)
    st[:fi] *= np.linspace(0, 1, fi)[:, None]
    fo = int(0.8 * SR)
    st[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    st /= np.max(np.abs(st)) / 0.93
    return st


def main():
    cues = json.load(open(sys.argv[1]))
    st = build(cues)
    pcm = (st * 32767).astype('<i2')
    with wave.open(sys.argv[2], 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', sys.argv[2], st.shape[0] / SR, 's')


if __name__ == '__main__':
    main()
