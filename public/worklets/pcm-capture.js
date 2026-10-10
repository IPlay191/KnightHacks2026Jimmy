/*
 * AudioWorkletProcessor that forwards raw microphone PCM (mono mix) to the
 * main thread in ~4096-frame batches while capturing is enabled (R5.1).
 * Must be a standalone file loaded via audioWorklet.addModule().
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturing = false;
    this.batch = new Float32Array(4096);
    this.filled = 0;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === "capture") {
        this.capturing = Boolean(msg.value);
        if (!this.capturing) this.flush();
      } else if (msg.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush() {
    if (this.filled > 0) {
      this.port.postMessage({ type: "pcm", samples: this.batch.slice(0, this.filled) });
      this.filled = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.capturing || !input || input.length === 0) return true;
    const frames = input[0].length;
    const channels = input.length;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += input[c][i];
      this.batch[this.filled++] = sum / channels;
      if (this.filled === this.batch.length) {
        this.port.postMessage({ type: "pcm", samples: this.batch });
        this.batch = new Float32Array(4096);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
