import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  AsciiMagicFrame,
  AsciiMagicPieceMeta,
  AsciiMagicPreviewSnapshot,
} from "../../types";
import { registerWallpaperCacheCleaner } from "../wallpaperCacheRegistry";

interface PendingRequest {
  resolve: (value: SandboxResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type SandboxResponse =
  | {
      type: "loaded";
      seq: number;
      slug: string;
      meta: AsciiMagicPieceMeta;
      frame: AsciiMagicFrame;
    }
  | {
      type: "preview";
      seq: number;
      slug: string;
      meta: AsciiMagicPieceMeta;
      frame: AsciiMagicFrame;
    }
  | {
      type: "frame";
      seq: number;
      slug: string;
      frame: AsciiMagicFrame;
    }
  | {
      type: "error";
      seq: number;
      error: string;
    };

const BOOT_TIMEOUT_MS = 6000;
const LOAD_TIMEOUT_MS = 10000;
const FRAME_TIMEOUT_MS = 2000;

class AsciiMagicSandboxBridge {
  private iframe: HTMLIFrameElement | null = null;
  private bootPromise: Promise<void> | null = null;
  private expectedOrigin = "";
  private nextSeq = 1;
  private pending = new Map<number, PendingRequest>();
  private messageListenerBound = false;
  private activeLoadedSlug = "";
  private activeLoadedVersion = "";
  private consumerCount = 0;
  private idleDisposeTimer: ReturnType<typeof setTimeout> | null = null;

  private clearIdleDisposeTimer(): void {
    if (this.idleDisposeTimer !== null) {
      clearTimeout(this.idleDisposeTimer);
      this.idleDisposeTimer = null;
    }
  }

  retainConsumer(): void {
    this.consumerCount++;
    this.clearIdleDisposeTimer();
  }

  releaseConsumer(): void {
    this.consumerCount = Math.max(0, this.consumerCount - 1);
    if (this.consumerCount === 0) {
      this.scheduleIdleDispose();
    }
  }

  disposeIfIdle(): void {
    if (this.consumerCount <= 0 && this.pending.size === 0) {
      this.consumerCount = 0;
      this.dispose();
    }
  }

  private scheduleIdleDispose(): void {
    this.clearIdleDisposeTimer();
    this.idleDisposeTimer = setTimeout(() => {
      this.idleDisposeTimer = null;
      if (this.consumerCount === 0 && this.pending.size === 0) {
        this.dispose();
      }
    }, 1200);
  }

  private handleMessage = (ev: MessageEvent<unknown>): void => {
    if (!this.iframe || ev.source !== this.iframe.contentWindow) return;
    if (
      !this.expectedOrigin ||
      this.expectedOrigin === "null" ||
      ev.origin !== this.expectedOrigin
    ) {
      return;
    }

    const data = ev.data as SandboxResponse | null;
    if (!data || typeof data !== "object" || typeof data.seq !== "number") {
      return;
    }

    const req = this.pending.get(data.seq);
    if (!req) return;
    clearTimeout(req.timer);
    this.pending.delete(data.seq);

    if (data.type === "error") {
      req.reject(new Error(data.error || "ASCII Magic sandbox error"));
      return;
    }
    req.resolve(data);
  };

  private rejectAllPending(reason: string): void {
    for (const [seq, req] of this.pending.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
      this.pending.delete(seq);
    }
  }

  private resetIframe(reason: string): void {
    this.rejectAllPending(reason);
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.bootPromise = null;
    this.activeLoadedSlug = "";
    this.activeLoadedVersion = "";
  }

  private ensureReady(): Promise<void> {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return Promise.reject(new Error("DOM environment unavailable"));
    }
    if (!("__TAURI_INTERNALS__" in window)) {
      return Promise.reject(new Error("ASCII sandbox protocol requires Tauri runtime"));
    }
    if (this.iframe && this.bootPromise) {
      return this.bootPromise;
    }

    if (!this.messageListenerBound) {
      window.addEventListener("message", this.handleMessage);
      this.messageListenerBound = true;
    }

    const runnerUrl = convertFileSrc("runner.html", "ascii-sandbox");
    let resolvedOrigin = "";
    try {
      resolvedOrigin = new URL(runnerUrl).origin;
    } catch {
      resolvedOrigin = "";
    }
    if (!resolvedOrigin || resolvedOrigin === "null") {
      return Promise.reject(
        new Error("Invalid ASCII sandbox runner origin")
      );
    }
    this.expectedOrigin = resolvedOrigin;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.style.left = "-9999px";
    iframe.style.top = "-9999px";

    this.iframe = iframe;
    this.bootPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.resetIframe("ASCII sandbox runner timed out");
        reject(new Error("ASCII sandbox runner timed out"));
      }, BOOT_TIMEOUT_MS);

      iframe.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      iframe.onerror = () => {
        clearTimeout(timer);
        this.resetIframe("ASCII sandbox runner failed to load");
        reject(new Error("ASCII sandbox runner failed to load"));
      };

      iframe.src = runnerUrl;
      document.body.appendChild(iframe);
    });

    return this.bootPromise;
  }

  private async postRpc(
    payload: Record<string, unknown>,
    timeoutMs: number
  ): Promise<SandboxResponse> {
    await this.ensureReady();
    const target = this.iframe?.contentWindow;
    if (!target) {
      throw new Error("ASCII sandbox frame window missing");
    }

    if (!this.expectedOrigin || this.expectedOrigin === "null") {
      throw new Error("Invalid ASCII sandbox target origin");
    }

    const seq = this.nextSeq++;
    const targetOrigin = this.expectedOrigin;

    return new Promise<SandboxResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        this.resetIframe("ASCII sandbox execution timed out");
        reject(new Error("ASCII sandbox execution timed out"));
      }, timeoutMs);

      this.pending.set(seq, { resolve, reject, timer });
      target.postMessage({ ...payload, seq }, targetOrigin);
    });
  }

  async loadPiece(
    slug: string,
    version = ""
  ): Promise<{ slug: string; meta: AsciiMagicPieceMeta; frame: AsciiMagicFrame }> {
    const res = await this.postRpc(
      { type: "load", slug, version, timeSec: 0 },
      LOAD_TIMEOUT_MS
    );
    if (res.type !== "loaded") {
      throw new Error("Unexpected response while loading piece");
    }
    this.activeLoadedSlug = res.slug;
    this.activeLoadedVersion = version;
    return { slug: res.slug, meta: res.meta, frame: res.frame };
  }

  async computeFrame(
    slug: string,
    timeSec: number,
    version = ""
  ): Promise<AsciiMagicFrame> {
    if (
      this.activeLoadedSlug !== slug ||
      (version && this.activeLoadedVersion !== version)
    ) {
      await this.loadPiece(slug, version);
    }
    const res = await this.postRpc(
      { type: "frame", slug, timeSec },
      FRAME_TIMEOUT_MS
    );
    if (res.type !== "frame") {
      throw new Error("Unexpected response while computing frame");
    }
    return res.frame;
  }

  async capturePiecePreview(
    slug: string,
    version = ""
  ): Promise<AsciiMagicPreviewSnapshot> {
    this.clearIdleDisposeTimer();
    try {
      const res = await this.postRpc(
        { type: "preview", slug, version, timeSec: 0 },
        LOAD_TIMEOUT_MS
      );
      if (res.type !== "preview") {
        throw new Error("Unexpected response while capturing preview");
      }
      return { meta: res.meta, frame: res.frame };
    } finally {
      if (this.consumerCount === 0) {
        this.scheduleIdleDispose();
      }
    }
  }

  dispose(): void {
    this.clearIdleDisposeTimer();
    this.rejectAllPending("ASCII sandbox disposed");
    if (
      this.iframe?.contentWindow &&
      this.expectedOrigin &&
      this.expectedOrigin !== "null"
    ) {
      try {
        this.iframe.contentWindow.postMessage(
          { type: "dispose" },
          this.expectedOrigin
        );
      } catch {
        // Ignore teardown postMessage failures
      }
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.bootPromise = null;
    this.activeLoadedSlug = "";
    this.activeLoadedVersion = "";
    if (this.messageListenerBound && typeof window !== "undefined") {
      window.removeEventListener("message", this.handleMessage);
      this.messageListenerBound = false;
    }
  }
}

export const asciiMagicSandbox = new AsciiMagicSandboxBridge();

registerWallpaperCacheCleaner("ascii_magic_sandbox", () => {
  asciiMagicSandbox.disposeIfIdle();
});
