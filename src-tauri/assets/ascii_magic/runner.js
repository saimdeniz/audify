const ALLOWED_PARENTS = new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

if (window.top === window || !window.parent) {
  throw new Error("Sandbox runner must load inside an iframe");
}

let worker = null;
let parentOrigin = "";
let activeWorkerSlug = "";

function spawnWorker() {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = (ev) => {
    if (!parentOrigin) return;
    window.parent.postMessage(ev.data, parentOrigin);
  };
  worker.onerror = (ev) => {
    if (!parentOrigin) return;
    window.parent.postMessage(
      {
        type: "error",
        seq: 0,
        error: ev.message || "Sandbox worker error",
      },
      parentOrigin
    );
  };
}

function runOneShotPreview(data, origin) {
  const previewWorker = new Worker("./worker.js", { type: "module" });
  const cleanup = () => {
    previewWorker.onmessage = null;
    previewWorker.onerror = null;
    previewWorker.terminate();
  };
  previewWorker.onmessage = (ev) => {
    cleanup();
    if (origin) {
      window.parent.postMessage(ev.data, origin);
    }
  };
  previewWorker.onerror = (ev) => {
    cleanup();
    if (origin) {
      window.parent.postMessage(
        {
          type: "error",
          seq: Number(data.seq) || 0,
          error: ev.message || "Sandbox preview worker error",
        },
        origin
      );
    }
  };
  previewWorker.postMessage(data);
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window.parent) return;
  if (!ALLOWED_PARENTS.has(ev.origin)) return;
  if (!ev.data || typeof ev.data.type !== "string") return;

  parentOrigin = ev.origin;

  if (ev.data.type === "dispose") {
    activeWorkerSlug = "";
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    return;
  }

  if (ev.data.type === "preview") {
    runOneShotPreview(ev.data, parentOrigin);
    return;
  }

  if (ev.data.type === "load") {
    const nextSlug = typeof ev.data.slug === "string" ? ev.data.slug : "";
    // Recycle worker when switching pieces so V8's ES module map frees prior scene modules
    if (!worker || (activeWorkerSlug && activeWorkerSlug !== nextSlug)) {
      spawnWorker();
    }
    activeWorkerSlug = nextSlug;
    worker.postMessage(ev.data);
    return;
  }

  if (!worker) spawnWorker();
  worker.postMessage(ev.data);
});
