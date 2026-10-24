// Audio for voice calls. The voice service speaks 16 kHz, 16-bit mono PCM; the browser runs at its own rate.
// Microphone samples are resampled to 16 kHz and posted to the page in 20 ms chunks.
// PCM posted by the page is queued, resampled to the browser rate and played.
const RATE = 16000, CHUNK = 320;
class DhanaviVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / RATE;
    this.inPos = 0;
    this.chunk = new Int16Array(CHUNK); this.filled = 0;
    this.queue = []; this.playPos = 0;
    this.port.onmessage = e => {
      if (e.data === 'clear') { this.queue = []; this.playPos = 0; return; }
      const pcm = new Int16Array(e.data), samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
      if (samples.length) this.queue.push(samples);
    };
  }
  capture(input) {
    for (; this.inPos < input.length; this.inPos += this.step) {
      const i = Math.floor(this.inPos), t = this.inPos - i;
      const a = input[i], b = i + 1 < input.length ? input[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * t));
      this.chunk[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === CHUNK) { this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]); this.chunk = new Int16Array(CHUNK); this.filled = 0; }
    }
    this.inPos -= input.length;
  }
  play(output) {
    for (let j = 0; j < output.length; j++) {
      const current = this.queue[0];
      if (!current) { output[j] = 0; continue; }
      const i = Math.floor(this.playPos), t = this.playPos - i;
      const next = i + 1 < current.length ? current[i + 1] : (this.queue[1]?.[0] ?? current[i]);
      output[j] = current[i] + (next - current[i]) * t;
      this.playPos += 1 / this.step;
      if (this.playPos >= current.length) { this.playPos -= current.length; this.queue.shift(); }
    }
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input?.length) this.capture(input);
    const output = outputs[0];
    if (output?.[0]) { this.play(output[0]); for (let c = 1; c < output.length; c++) output[c].set(output[0]); }
    return true;
  }
}
registerProcessor('dhanavi-voice', DhanaviVoice);
