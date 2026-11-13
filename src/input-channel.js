export const INPUT_BUFFER_SIZE = 1024 * 1024;
const CONTROL_WORDS = 2;

export class SharedInputChannel {
  constructor(inputBufferSize = INPUT_BUFFER_SIZE) {
    this.inputBufferSize = inputBufferSize;
    this.controlBuffer = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * CONTROL_WORDS,
    );
    this.inputBuffer = new SharedArrayBuffer(inputBufferSize);
    this.control = new Int32Array(this.controlBuffer);
    this.bytes = new Uint8Array(this.inputBuffer);
    this.head = 0;
  }

  reset() {
    this.head = 0;
    Atomics.store(this.control, 0, 0);
    Atomics.store(this.control, 1, 0);
  }

  write(text) {
    const encoded = new TextEncoder().encode(text);
    if (this.head + encoded.byteLength > this.bytes.byteLength) {
      throw new Error("Inputbufferen er fuld.");
    }

    this.bytes.set(encoded, this.head);
    this.head += encoded.byteLength;
    Atomics.store(this.control, 0, this.head);
    Atomics.notify(this.control, 0);
  }

  close() {
    Atomics.store(this.control, 1, 1);
    Atomics.notify(this.control, 0);
  }
}
