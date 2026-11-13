import { ConsoleStdout, Fd, PreopenDirectory, WASI, wasi } from "@bjorn3/browser_wasi_shim";
import { RubyVM } from "@ruby/wasm-wasi";
import rubyWasmUrl from "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm?url";

const CONTROL_AVAILABLE = 0;
const CONTROL_CLOSED = 1;
const RUBY_ARGS = ["ruby.wasm", "-EUTF-8", "-e_=0"];

let vm;
let stdin;
let running = false;

class InteractiveStdin extends Fd {
  constructor(control, bytes) {
    super();
    this.control = control;
    this.bytes = bytes;
    this.position = 0;
    this.waitingAnnounced = false;
  }

  reset() {
    this.position = 0;
    this.waitingAnnounced = false;
  }

  fd_fdstat_get() {
    const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
    fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
    return { ret: wasi.ERRNO_SUCCESS, fdstat };
  }

  fd_filestat_get() {
    return {
      ret: wasi.ERRNO_SUCCESS,
      filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n),
    };
  }

  fd_fdstat_set_flags() {
    return wasi.ERRNO_SUCCESS;
  }

  fd_read(size) {
    if (size === 0) {
      return { ret: wasi.ERRNO_SUCCESS, data: new Uint8Array() };
    }

    let available = Atomics.load(this.control, CONTROL_AVAILABLE);
    while (
      available <= this.position &&
      Atomics.load(this.control, CONTROL_CLOSED) === 0
    ) {
      if (!this.waitingAnnounced) {
        this.waitingAnnounced = true;
        self.postMessage({ type: "input-request" });
      }
      Atomics.wait(this.control, CONTROL_AVAILABLE, available);
      available = Atomics.load(this.control, CONTROL_AVAILABLE);
    }

    if (available <= this.position) {
      return { ret: wasi.ERRNO_SUCCESS, data: new Uint8Array() };
    }

    this.waitingAnnounced = false;
    const end = Math.min(available, this.position + size);
    const data = this.bytes.slice(this.position, end);
    this.position = end;
    return { ret: wasi.ERRNO_SUCCESS, data };
  }
}

function createOutput(stream) {
  const decoder = new TextDecoder();
  return new ConsoleStdout((bytes) => {
    const text = decoder.decode(bytes, { stream: true });
    if (text) {
      self.postMessage({ type: "output", stream, text });
    }
  });
}

async function loadRuby() {
  const response = await fetch(rubyWasmUrl);
  if (!response.ok) {
    throw new Error(`Kunne ikke hente Ruby-runtime (${response.status}).`);
  }

  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body?.getReader();
  let buffer;

  if (!reader) {
    buffer = new Uint8Array(await response.arrayBuffer());
  } else {
    const chunks = [];
    let loaded = 0;
    let lastProgress = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;

      if (total) {
        const progress = Math.min(99, Math.round((loaded / total) * 100));
        if (progress !== lastProgress) {
          lastProgress = progress;
          self.postMessage({ type: "boot-progress", progress });
        }
      }
    }

    buffer = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }

  self.postMessage({ type: "boot-stage", stage: "compile" });
  return WebAssembly.compile(buffer);
}

async function initialize({ controlBuffer, inputBuffer }) {
  const control = new Int32Array(controlBuffer);
  const bytes = new Uint8Array(inputBuffer);
  stdin = new InteractiveStdin(control, bytes);

  const rubyModule = await loadRuby();
  const wasiInstance = new WASI(
    [],
    [],
    [
      stdin,
      createOutput("stdout"),
      createOutput("stderr"),
      new PreopenDirectory("/", new Map()),
    ],
    { debug: false },
  );

  ({ vm } = await RubyVM.instantiateModule({
    module: rubyModule,
    wasip1: wasiInstance,
    args: RUBY_ARGS,
  }));

  self.postMessage({ type: "ready" });
}

function run(code) {
  if (running || !vm) return;

  running = true;
  stdin.reset();
  self.postMessage({ type: "run-start" });

  try {
    vm.eval(code);
    self.postMessage({ type: "run-end" });
  } catch (error) {
    self.postMessage({
      type: "run-error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "init") {
    initialize(message).catch((error) => {
      self.postMessage({
        type: "fatal",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  } else if (message.type === "run") {
    run(message.code);
  }
});
