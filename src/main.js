import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import "./styles.css";
import { SharedInputChannel } from "./input-channel.js";

const SAMPLE_CODE = `puts "Hej! Hvad hedder du?"
navn = gets.chomp

puts "Velkommen, #{navn}!"
puts
puts "Skriv to tal:"

tal_1 = gets.chomp.to_i
tal_2 = gets.chomp.to_i

puts "#{tal_1} + #{tal_2} = #{tal_1 + tal_2}"`;

const STORAGE_KEY = "ruby-repl-code-v1";
const elements = {
  badge: document.querySelector("#runtime-badge"),
  bootMessage: document.querySelector("#boot-message"),
  bootOverlay: document.querySelector("#boot-overlay"),
  bootProgress: document.querySelector(".boot-progress span"),
  bootTitle: document.querySelector("#boot-title"),
  clear: document.querySelector("#clear-output"),
  editor: document.querySelector("#editor"),
  input: document.querySelector("#terminal-input"),
  inputForm: document.querySelector("#input-form"),
  output: document.querySelector("#terminal-output"),
  resetCode: document.querySelector("#reset-code"),
  run: document.querySelector("#run-code"),
  runtimeLabel: document.querySelector("#runtime-label"),
  status: document.querySelector("#run-status"),
  statusText: document.querySelector("#status-text"),
  stop: document.querySelector("#stop-code"),
};

const rubyHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#687b8f", fontStyle: "italic" },
  { tag: [tags.keyword, tags.modifier], color: "#ff7bac" },
  { tag: [tags.string, tags.special(tags.string)], color: "#b8e986" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#ffca80" },
  { tag: [tags.variableName, tags.propertyName], color: "#e7edf4" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#7dd3fc" },
  { tag: [tags.className, tags.typeName], color: "#f9d477" },
  { tag: [tags.operator, tags.punctuation], color: "#8fa7bd" },
  { tag: [tags.regexp, tags.escape], color: "#ff9f9f" },
  { tag: tags.meta, color: "#c7a6ff" },
]);

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: "#e7edf4",
      backgroundColor: "#0e151e",
      fontSize: "14px",
    },
    ".cm-scroller": {
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", monospace',
      lineHeight: "1.72",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "18px 0 32px",
      caretColor: "#fb7185",
    },
    ".cm-line": {
      padding: "0 20px 0 10px",
    },
    ".cm-gutters": {
      backgroundColor: "#0e151e",
      color: "#526274",
      border: "none",
      paddingLeft: "8px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "#9db0c3",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.025)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(125, 211, 252, 0.16) !important",
    },
    ".cm-cursor": {
      borderLeftColor: "#fb7185",
      borderLeftWidth: "2px",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(251, 113, 133, 0.16)",
      outline: "1px solid rgba(251, 113, 133, 0.35)",
    },
    ".cm-tooltip": {
      backgroundColor: "#17212d",
      border: "1px solid #2a3949",
      borderRadius: "8px",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "#233246",
      color: "#ffffff",
    },
  },
  { dark: true },
);

let worker;
let runtimeReady = false;
let running = false;
let waitingForInput = false;
let inputChannel;
let bootProgress = 0;

const editor = new EditorView({
  parent: elements.editor,
  state: EditorState.create({
    doc: localStorage.getItem(STORAGE_KEY) || SAMPLE_CODE,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(rubyHighlightStyle),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      StreamLanguage.define(ruby),
      EditorView.lineWrapping,
      editorTheme,
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            if (!running) runCode();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          localStorage.setItem(STORAGE_KEY, update.state.doc.toString());
        }
      }),
    ],
  }),
});

function setStatus(kind, text) {
  elements.status.dataset.kind = kind;
  elements.statusText.textContent = text;
}

function setRunning(value) {
  running = value;
  elements.run.hidden = value;
  elements.stop.hidden = !value;
  elements.resetCode.disabled = value;
}

function setInputWaiting(value) {
  waitingForInput = value;
  elements.input.disabled = !value;
  elements.input.placeholder = value
    ? "Skriv input og tryk Enter"
    : running
      ? "Venter på næste input fra programmet…"
      : "Koden er ikke klar til input endnu";

  if (value) {
    requestAnimationFrame(() => elements.input.focus());
  }
}

function hideBootOverlay() {
  elements.bootOverlay.classList.add("is-hidden");
}

function appendOutput(text, stream = "stdout") {
  if (!text) return;
  const span = document.createElement("span");
  span.className = `output-${stream}`;
  span.textContent = text;
  elements.output.append(span);
  elements.output.scrollTop = elements.output.scrollHeight;
}

function clearOutput() {
  elements.output.replaceChildren();
}

function writeInput(text) {
  if (!waitingForInput || !inputChannel) return;

  try {
    inputChannel.write(`${text}\n`);
    appendOutput(`${text}\n`, "echo");
    setInputWaiting(false);
    setStatus("running", "Kører…");
  } catch (error) {
    appendOutput(`\n${error.message}\n`, "stderr");
  }
}

function runCode() {
  if (!runtimeReady || running) return;

  clearOutput();
  inputChannel.reset();
  setRunning(true);
  setInputWaiting(false);
  setStatus("running", "Kører…");
  elements.input.value = "";
  worker.postMessage({ type: "run", code: editor.state.doc.toString() });
}

function stopCode() {
  if (!running) return;

  if (inputChannel) inputChannel.close();
  worker.terminate();
  setRunning(false);
  setInputWaiting(false);
  setStatus("idle", "Stoppet");
  appendOutput("Programmet blev stoppet.\n", "stderr");
  createWorker();
}

function showFatalError(message) {
  runtimeReady = false;
  setRunning(false);
  setInputWaiting(false);
  elements.run.disabled = true;
  elements.badge.dataset.state = "error";
  elements.runtimeLabel.textContent = "Runtimefejl";
  elements.bootOverlay.classList.remove("is-hidden");
  elements.bootTitle.textContent = "Ruby kunne ikke starte";
  elements.bootMessage.textContent = message;
  elements.bootOverlay.classList.add("has-error");
  setStatus("error", "Runtimefejl");
  console.error(message);
}

function createWorker() {
  runtimeReady = false;
  elements.run.disabled = true;
  elements.badge.dataset.state = "loading";
  elements.runtimeLabel.textContent = "Starter Ruby 3.4";
  bootProgress = 0;
  elements.bootOverlay.classList.remove("is-hidden", "has-error");
  elements.bootTitle.textContent = "Starter Ruby 3.4";
  elements.bootMessage.textContent =
    "Henter WebAssembly-runtime og gør editoren klar. Det kan tage et øjeblik første gang.";
  elements.bootProgress.style.width = "4%";

  if (
    typeof SharedArrayBuffer === "undefined" ||
    !window.crossOriginIsolated
  ) {
    showFatalError(
      "Interaktiv terminal kræver SharedArrayBuffer. Server appen med COOP- og COEP-headers (se README).",
    );
    return;
  }

  inputChannel = new SharedInputChannel();
  worker = new Worker(new URL("./ruby-worker.js", import.meta.url), {
    type: "module",
  });

  worker.addEventListener("message", (event) => {
    const message = event.data;

    switch (message.type) {
      case "boot-progress":
        bootProgress = message.progress;
        elements.bootProgress.style.width = `${Math.max(4, bootProgress)}%`;
        break;
      case "boot-stage":
        elements.bootTitle.textContent = "Gør Ruby klar";
        elements.bootMessage.textContent =
          "WebAssembly-runtime er hentet. Ruby starter nu i din browser.";
        elements.bootProgress.style.width = "100%";
        break;
      case "ready":
        runtimeReady = true;
        elements.run.disabled = false;
        elements.badge.dataset.state = "ready";
        elements.runtimeLabel.textContent = "Ruby 3.4 · klar";
        setStatus("idle", "Klar til at køre");
        hideBootOverlay();
        break;
      case "input-request":
        if (running) {
          setInputWaiting(true);
          setStatus("input", "Venter på input");
        }
        break;
      case "output":
        appendOutput(message.text, message.stream);
        break;
      case "run-error":
        appendOutput(
          `${message.message.startsWith("\n") ? "" : "\n"}${message.message}\n`,
          "error",
        );
        setRunning(false);
        setInputWaiting(false);
        setStatus("error", "Programmet stoppede med fejl");
        break;
      case "run-end":
        if (running) {
          setRunning(false);
          setInputWaiting(false);
          setStatus("success", "Fuldført");
          const output = elements.output.textContent;
          if (output && !output.endsWith("\n")) appendOutput("\n");
        }
        break;
      case "fatal":
        showFatalError(message.message);
        break;
    }
  });

  worker.addEventListener("error", (event) => {
    showFatalError(event.message || "Web Worker stoppede uventet.");
  });

  worker.postMessage({
    type: "init",
    controlBuffer: inputChannel.controlBuffer,
    inputBuffer: inputChannel.inputBuffer,
  });
}

elements.run.addEventListener("click", runCode);
elements.stop.addEventListener("click", stopCode);
elements.clear.addEventListener("click", clearOutput);
elements.resetCode.addEventListener("click", () => {
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: SAMPLE_CODE,
    },
  });
  editor.focus();
});
elements.inputForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = elements.input.value;
  elements.input.value = "";
  writeInput(value);
});

setInputWaiting(false);
createWorker();
