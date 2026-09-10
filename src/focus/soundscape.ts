/**
 * The stations that are made rather than fetched.
 *
 * Same approach as the chime: oscillators and noise, no asset and no request,
 * so this half of the player works with the network off. Everything runs
 * through one gain node so a fade is a fade rather than a click.
 */

/** Long enough that the loop is not audible as a loop. */
const NOISE_SECONDS = 6;

/**
 * Per-voice trim, measured rather than guessed: rendered offline, these came
 * out at 0.20, 0.23 and 0.33 RMS, and the drone peaked past 1.0 where it would
 * have clipped. These bring all three to about 0.14, so changing station does
 * not change how loud the room is.
 */
const TRIM: Record<"brown" | "rain" | "drone", number> = {
  brown: 0.7,
  rain: 0.6,
  drone: 0.42,
};

export interface Soundscape {
  stop(): void;
}

function noiseBuffer(ctx: BaseAudioContext, fill: (data: Float32Array) => void): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate);
  fill(buffer.getChannelData(0));
  return buffer;
}

/** White noise integrated into brown: the low end that people actually mean. */
function fillBrown(data: Float32Array): void {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
}

function fillWhite(data: Float32Array): void {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function looping(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

export function startSoundscape(
  ctx: BaseAudioContext,
  voice: "brown" | "rain" | "drone",
  output: AudioNode,
): Soundscape {
  const nodes: { stop?: () => void }[] = [];

  const trim = ctx.createGain();
  trim.gain.value = TRIM[voice];
  trim.connect(output);

  if (voice === "brown") {
    const source = looping(ctx, noiseBuffer(ctx, fillBrown));
    source.connect(trim);
    source.start();
    nodes.push({ stop: () => source.stop() });
  }

  if (voice === "rain") {
    // Bandpassed noise for the hiss, with a slow wander so it breathes rather
    // than sitting still the way a flat filter does.
    const source = looping(ctx, noiseBuffer(ctx, fillWhite));
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1000;
    band.Q.value = 0.4;

    const roll = ctx.createBiquadFilter();
    roll.type = "lowpass";
    roll.frequency.value = 5200;

    const wander = ctx.createOscillator();
    wander.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    wander.connect(depth).connect(band.frequency);

    source.connect(band).connect(roll).connect(trim);
    source.start();
    wander.start();
    nodes.push({ stop: () => source.stop() }, { stop: () => wander.stop() });
  }

  if (voice === "drone") {
    // Three detuned voices a fifth apart. Slightly out of tune with each other
    // on purpose: perfectly tuned oscillators beat against nothing and sound
    // like a test tone.
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 700;
    lowpass.connect(trim);

    for (const [hz, level] of [
      [55, 0.5],
      [82.5, 0.28],
      [110.3, 0.2],
    ] as const) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = hz;

      const gain = ctx.createGain();
      gain.gain.value = level;

      // A slow swell, so the pad moves without ever arriving anywhere.
      const swell = ctx.createOscillator();
      swell.frequency.value = 0.03 + Math.random() * 0.02;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = level * 0.25;
      swell.connect(swellDepth).connect(gain.gain);

      oscillator.connect(gain).connect(lowpass);
      oscillator.start();
      swell.start();
      nodes.push({ stop: () => oscillator.stop() }, { stop: () => swell.stop() });
    }
  }

  return {
    stop(): void {
      for (const node of nodes) {
        try {
          node.stop?.();
        } catch {
          // Already stopped; there is nothing to undo.
        }
      }
    },
  };
}
