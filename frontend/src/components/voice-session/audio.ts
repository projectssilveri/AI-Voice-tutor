/**
 * Browser audio plumbing for a Gemini Live session.
 *
 * Two jobs, both latency-critical:
 *   - capture the mic as 16 kHz PCM16 and hand it to the socket
 *   - play 24 kHz PCM16 coming back, and be able to DROP ALL OF IT instantly
 *
 * That second half is the whole game. Gemini cancels its own generation the
 * moment the student speaks, but whatever already reached the browser is still
 * queued and will keep playing. If the queue is not flushed, the tutor audibly
 * talks over the student for another second or two and barge-in looks broken.
 * This is the single most common way to get this wrong.
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

/** Convert Float32 [-1, 1] samples to little-endian PCM16. */
export function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    // Clamp before scaling: values outside [-1, 1] wrap and become loud clicks.
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** Convert little-endian PCM16 bytes to Float32 [-1, 1]. */
export function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const out = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

/**
 * Plays a stream of PCM16 chunks in order, and can drop everything on demand.
 *
 * Chunks are scheduled back-to-back against the AudioContext clock rather than
 * played on arrival, otherwise network jitter shows up as audible gaps. Every
 * scheduled source is tracked so `flush()` can stop all of them — a source that
 * has already started will not stop on its own.
 */
export class PcmPlayer {
  private context: AudioContext;
  private gain: GainNode;
  private analyser: AnalyserNode;
  /** Sources scheduled but not yet finished. Tracked so flush() can kill them. */
  private scheduled = new Set<AudioBufferSourceNode>();
  /** Context time at which the next chunk should start. */
  private nextStartTime = 0;
  /** Claimed synchronously by `close()`, so a second call is a no-op. */
  private closed = false;

  constructor(sampleRate: number = OUTPUT_SAMPLE_RATE) {
    this.context = new AudioContext({ sampleRate });
    this.gain = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    // 1024 rather than 256. The amplitude ring only ever needed a peak, so
    // the coarsest window did; the frequency visualiser needs to tell a vowel
    // from a consonant. At 256 the bins are ~94 Hz apart, which puts the whole
    // bottom of a voice — where the rhythm of speech actually lives — inside
    // the first two bins. 1024 gives ~23 Hz bins for a 42 ms window, still
    // well under the eye's threshold for lag.
    this.analyser.fftSize = 1024;
    // The default 0.8 averages so heavily that a syllable is over before the
    // bars finish rising. The visualiser applies its own asymmetric decay —
    // fast up, slow down — which is what makes a level meter readable, so the
    // smoothing here only needs to take the jitter off.
    this.analyser.smoothingTimeConstant = 0.6;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  get analyserNode(): AnalyserNode {
    return this.analyser;
  }

  /**
   * The rate this player was opened at.
   *
   * An AudioContext's sample rate is fixed at construction, so the only way to
   * honour a different rate from the server is to build a new player. The
   * caller compares this against what `ready` reported.
   */
  get sampleRate(): number {
    return this.context.sampleRate;
  }

  /** True while audio is scheduled to play. Drives the "AI speaking" state. */
  get isPlaying(): boolean {
    return this.scheduled.size > 0;
  }

  /** The AudioContext clock, in seconds. */
  get currentTime(): number {
    return this.context.currentTime;
  }

  /**
   * Clock time at which everything queued so far will have finished playing.
   *
   * Used to pace the caption feed. Gemini generates a turn's audio roughly
   * twice as fast as it plays, so transcript fragments arrive far ahead of the
   * voice saying them; timestamping each fragment against this lets the
   * captions be revealed in step with what is actually being heard.
   */
  get queuedUntil(): number {
    return Math.max(this.nextStartTime, this.context.currentTime);
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  enqueue(pcm: ArrayBuffer): void {
    // A frame still in flight when the session ends would otherwise hit a
    // closed context, and createBuffer throws on one.
    if (this.closed) return;
    const samples = pcm16ToFloat32(pcm);
    if (samples.length === 0) return;

    const buffer = this.context.createBuffer(
      1,
      samples.length,
      this.context.sampleRate,
    );
    // `.set()` rather than `copyToChannel`: the latter's signature pins the
    // typed array's backing buffer type, which our decoded samples do not
    // satisfy under TS 5.7+.
    buffer.getChannelData(0).set(samples);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    // Never schedule in the past: if the queue drained while the network
    // stalled, start from now instead of a stale timestamp.
    const startAt = Math.max(this.context.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.scheduled.add(source);
    source.onended = () => {
      this.scheduled.delete(source);
    };
  }

  /**
   * Stop and discard everything queued. Called the instant the server reports
   * an interruption.
   */
  flush(): void {
    for (const source of this.scheduled) {
      // onended still fires on stop(); clear it first so the handler does not
      // mutate the set we are iterating.
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished between the interrupt and this call.
      }
      source.disconnect();
    }
    this.scheduled.clear();
    this.nextStartTime = this.context.currentTime;
  }

  /** Safe to call more than once — see the note on `MicCapture.stop`. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.flush();
    if (this.context.state !== "closed") {
      await this.context.close();
    }
  }
}

/**
 * Captures the microphone as PCM16 at the rate Gemini expects.
 *
 * The AudioContext is opened at 16 kHz so the browser resamples for us; doing
 * it by hand in JS is both slower and worse quality.
 */
export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private analyser: AnalyserNode | null = null;

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /**
   * Whether the browser CONFIRMED it is filtering background noise.
   *
   * `getUserMedia` is asked for noise suppression below, but a constraint is a
   * request, not a guarantee: a browser or a device that cannot do it simply
   * gives you a track without it. Reading the track's settings back is the
   * difference between telling the student their background is being cleaned
   * up and telling them we asked nicely. Null means the browser did not say.
   */
  get noiseSuppressed(): boolean | null {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return null;
    const settings = track.getSettings();
    return typeof settings.noiseSuppression === "boolean"
      ? settings.noiseSuppression
      : null;
  }

  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    // 1024 rather than 256. The amplitude ring only ever needed a peak, so
    // the coarsest window did; the frequency visualiser needs to tell a vowel
    // from a consonant. At 256 the bins are ~94 Hz apart, which puts the whole
    // bottom of a voice — where the rhythm of speech actually lives — inside
    // the first two bins. 1024 gives ~23 Hz bins for a 42 ms window, still
    // well under the eye's threshold for lag.
    this.analyser.fftSize = 1024;
    // The default 0.8 averages so heavily that a syllable is over before the
    // bars finish rising. The visualiser applies its own asymmetric decay —
    // fast up, slow down — which is what makes a level meter readable, so the
    // smoothing here only needs to take the jitter off.
    this.analyser.smoothingTimeConstant = 0.6;
    this.source.connect(this.analyser);

    // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it needs
    // no separate module file and is well supported. Worth revisiting if the
    // main thread turns out to be busy enough to cause dropouts.
    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      onChunk(floatTo16BitPCM(event.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    // Required for onaudioprocess to fire in Chrome. Gain is zero so the
    // student does not hear themselves echoed back.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    this.processor.connect(mute);
    mute.connect(this.context.destination);
  }

  /**
   * Release the microphone. Safe to call more than once, including twice
   * concurrently.
   *
   * `context.state !== "closed"` is not enough of a guard on its own: `close()`
   * is async, so a second call arriving before the first resolves still sees
   * "running" and calls it again, which throws `InvalidStateError`. Everything
   * is detached synchronously and the fields cleared BEFORE the first await, so
   * the second call has nothing left to act on.
   */
  async stop(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());

    const context = this.context;
    this.processor = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.context = null;

    if (context && context.state !== "closed") {
      await context.close();
    }
  }
}

/** Peak amplitude 0..1 from an analyser, for driving the avatar animation. */
export function readAmplitude(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    // Byte time-domain data is centred on 128.
    peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
  }
  return peak;
}

// ---------------------------------------------------------------------------
// The spectrum, for the active-speaker visualiser
// ---------------------------------------------------------------------------

/** What one frame of analysis says about the sound. */
export interface AudioFrame {
  /** Peak amplitude, 0..1. The same figure `readAmplitude` returns. */
  level: number;
  /** Energy below ~250 Hz, 0..1 — what you feel as weight and rhythm. */
  bass: number;
  /** Energy ~250 Hz to 2 kHz, 0..1 — where most of a speaking voice sits. */
  mid: number;
  /** Energy above ~2 kHz, 0..1 — consonants, sibilance, brightness. */
  treble: number;
  /**
   * Log-spaced band magnitudes, 0..1, low frequency first.
   *
   * Log-spaced rather than linear because the FFT's bins are linear in hertz
   * and hearing is not: half of a linear visualiser's bars land above 4 kHz,
   * where a voice has almost nothing, so a linear bar chart of speech is a
   * cluster of movement on the far left and a flat line everywhere else.
   *
   * Reused between frames. Copy it if you need to keep it.
   */
  bars: Float32Array;
}

/** Lowest and highest frequency the bars span. */
const BAR_MIN_HZ = 70;
const BAR_MAX_HZ = 8_000;

const BASS_MAX_HZ = 250;
const MID_MAX_HZ = 2_000;

/**
 * Reads amplitude and a log-spaced spectrum from one analyser.
 *
 * A CLASS, AND THAT IS THE POINT. `readAmplitude` allocates a fresh
 * `Uint8Array` on every call, and it is called on every animation frame for
 * both the tutor and the microphone — 120 short-lived arrays a second, each
 * one garbage the collector has to walk. That is survivable for one small
 * buffer and is not for the spectrum, which is read on every frame as well.
 * The buffers and the bin-to-bar mapping are computed once here and reused.
 *
 * The mapping depends on the analyser's sample rate and fftSize, both fixed
 * for the life of the node, so building it in the constructor is safe.
 */
export class AudioMeter {
  private readonly analyser: AnalyserNode;
  // `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`. Since TS 5.7 the type
  // is generic over its backing buffer, and the bare form widens to
  // `ArrayBufferLike` — which includes `SharedArrayBuffer`, and the Web Audio
  // `getByteFrequencyData` signature will not accept one.
  private readonly timeData: Uint8Array<ArrayBuffer>;
  private readonly freqData: Uint8Array<ArrayBuffer>;
  /**
   * Where each bar reads from, precomputed.
   *
   * `from`/`to` is an inclusive bin range and `wide` says whether it actually
   * spans more than one bin — see `read` for why the narrow case is handled
   * differently.
   */
  private readonly barRanges: {
    from: number;
    to: number;
    wide: boolean;
    /** Fractional bin at the bar's centre, for the narrow case. */
    centre: number;
  }[];
  private readonly bassBins: number;
  private readonly midBins: number;
  private readonly frame: AudioFrame;

  constructor(analyser: AnalyserNode, barCount = 44) {
    this.analyser = analyser;
    const bins = analyser.frequencyBinCount;
    this.timeData = new Uint8Array(bins);
    this.freqData = new Uint8Array(bins);

    // Hertz per bin. `fftSize` rather than `frequencyBinCount`, because the
    // bins cover 0..Nyquist and Nyquist is half the sample rate.
    const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
    const nyquist = analyser.context.sampleRate / 2;
    const top = Math.min(BAR_MAX_HZ, nyquist);

    this.bassBins = Math.max(1, Math.round(BASS_MAX_HZ / hzPerBin));
    this.midBins = Math.max(
      this.bassBins + 1,
      Math.round(MID_MAX_HZ / hzPerBin),
    );

    const ratio = top / BAR_MIN_HZ;
    this.barRanges = [];
    for (let i = 0; i < barCount; i++) {
      const lo = BAR_MIN_HZ * Math.pow(ratio, i / barCount);
      const hi = BAR_MIN_HZ * Math.pow(ratio, (i + 1) / barCount);
      // WHICH BINS THIS BAR OWNS: the ones whose CENTRE falls inside it.
      //
      // Bin `n` is centred at `n * hzPerBin`, so the bins inside [lo, hi) are
      // ceil(lo/hz) .. floor(hi/hz). A bar can own none of them — down at
      // 70 Hz a bar is about 8 Hz wide and a bin is 23 Hz — and that case is
      // interpolated instead, in `read`.
      //
      // Both halves of this were wrong before, and each was visible:
      //
      //   Taking `floor(lo)..floor(hi)` and the max over it meant several
      //   neighbouring bars resolved to the SAME bin, so a bass note rendered
      //   as a flat plateau of identical bars. Measured: a 100 Hz tone lit
      //   three bars at exactly the same height.
      //
      //   Interpolating only the narrow bars, while wide bars still peak-held
      //   over any bin their range touched, made the two estimators disagree
      //   at the boundary — one pure tone produced TWO full-height bars with a
      //   dip between them. Owning a bin by its centre is what makes the two
      //   agree: exactly one bar contains any given bin centre.
      const first = Math.ceil(lo / hzPerBin);
      const last = Math.min(bins - 1, Math.floor(hi / hzPerBin));
      const wide = last >= first && first <= bins - 1;
      this.barRanges.push({
        from: Math.min(bins - 1, first),
        to: last,
        wide,
        centre: Math.min(bins - 1, (lo + hi) / 2 / hzPerBin),
      });
    }

    this.frame = {
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      bars: new Float32Array(barCount),
    };
  }

  get barCount(): number {
    return this.frame.bars.length;
  }

  /**
   * Analyse the current audio. The returned object is REUSED between calls,
   * so read what you need before calling again.
   */
  read(): AudioFrame {
    const frame = this.frame;

    this.analyser.getByteTimeDomainData(this.timeData);
    let peak = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      const deviation = Math.abs(this.timeData[i] - 128) / 128;
      if (deviation > peak) peak = deviation;
    }
    frame.level = peak;

    this.analyser.getByteFrequencyData(this.freqData);

    for (let i = 0; i < this.barRanges.length; i++) {
      const { from, to, wide, centre } = this.barRanges[i];
      if (wide) {
        // Peak-hold across the bins the bar covers. A bar that averaged would
        // bury a narrow, loud partial under the quiet bins either side of it,
        // which is what makes an averaged visualiser look sluggish.
        let loudest = 0;
        for (let bin = from; bin <= to; bin++) {
          if (this.freqData[bin] > loudest) loudest = this.freqData[bin];
        }
        frame.bars[i] = loudest / 255;
      } else {
        // Narrower than a bin: read BETWEEN the two neighbouring bins rather
        // than repeating one of them, so adjacent bars differ and a bass note
        // has a peak instead of a plateau.
        const lower = Math.floor(centre);
        const upper = Math.min(this.freqData.length - 1, lower + 1);
        const blend = centre - lower;
        frame.bars[i] =
          (this.freqData[lower] * (1 - blend) + this.freqData[upper] * blend) /
          255;
      }
    }

    frame.bass = this.average(0, this.bassBins);
    frame.mid = this.average(this.bassBins, this.midBins);
    frame.treble = this.average(this.midBins, this.freqData.length);
    return frame;
  }

  private average(from: number, to: number): number {
    const end = Math.min(to, this.freqData.length);
    if (end <= from) return 0;
    let total = 0;
    for (let i = from; i < end; i++) total += this.freqData[i];
    return total / (end - from) / 255;
  }
}
