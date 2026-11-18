let activeSlug = "";
let activeMeta = null;
let activeDraw = null;

function withDefaultParams(mod) {
  const paramsDef = mod && mod.meta && mod.meta.params;
  if (!paramsDef || typeof paramsDef !== "object") {
    return mod.default();
  }
  const values = {};
  for (const [key, def] of Object.entries(paramsDef)) {
    values[key] = def && "default" in def ? def.default : "";
  }
  return mod.default(values);
}

function normalizeMeta(mod, fallbackSlug) {
  const m = (mod && mod.meta) || {};
  return {
    slug: typeof m.slug === "string" && m.slug ? m.slug : fallbackSlug,
    name: typeof m.name === "string" ? m.name : fallbackSlug,
    category: typeof m.category === "string" ? m.category : "",
    cols: Number(m.cols) > 0 ? Number(m.cols) : 120,
    rows: Number(m.rows) > 0 ? Number(m.rows) : 40,
    fps: Number(m.fps) > 0 ? Number(m.fps) : 15,
    cell: typeof m.cell === "string" ? m.cell : "mono",
    look: typeof m.look === "string" ? m.look : "original",
    still: Boolean(m.still),
    dots: m.dots && typeof m.dots === "object" ? m.dots : null,
    palette: m.palette && typeof m.palette === "object" ? m.palette : null,
  };
}

function normalizeFrame(raw) {
  if (typeof raw === "string") {
    return { text: raw, color: null, paletteOverride: null };
  }
  if (raw && typeof raw === "object") {
    return {
      text: typeof raw.text === "string" ? raw.text : "",
      color: typeof raw.color === "string" ? raw.color : null,
      paletteOverride:
        raw.palette && typeof raw.palette === "object" ? raw.palette : null,
    };
  }
  return { text: "", color: null, paletteOverride: null };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== "string") return;
  const seq = Number(msg.seq) || 0;

  if (msg.type === "preview") {
    const slug = String(msg.slug || "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(slug)) {
      self.postMessage({ type: "error", seq, error: "Invalid ASCII Magic slug" });
      return;
    }
    try {
      const cacheBust = msg.version ? `?v=${encodeURIComponent(String(msg.version))}` : "";
      const mod = await import(`./pieces/${slug}.js${cacheBust}`);
      const fn = withDefaultParams(mod);
      const draw = typeof fn === "function" ? fn : () => fn;
      const t0 = Number.isFinite(msg.timeSec) ? Number(msg.timeSec) : 0;
      let frame = normalizeFrame(draw(t0));
      if (!frame.text.trim()) {
        frame = normalizeFrame(draw(1.2));
      }
      self.postMessage({
        type: "preview",
        seq,
        slug,
        meta: normalizeMeta(mod, slug),
        frame,
      });
    } catch (err) {
      self.postMessage({
        type: "error",
        seq,
        error: err && err.message ? String(err.message) : "Failed to capture preview",
      });
    }
    return;
  }

  if (msg.type === "load") {
    const slug = String(msg.slug || "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,95}$/.test(slug)) {
      self.postMessage({ type: "error", seq, error: "Invalid ASCII Magic slug" });
      return;
    }

    try {
      const cacheBust = msg.version ? `?v=${encodeURIComponent(String(msg.version))}` : "";
      const mod = await import(`./pieces/${slug}.js${cacheBust}`);
      const fn = withDefaultParams(mod);
      activeSlug = slug;
      activeMeta = normalizeMeta(mod, slug);
      activeDraw = typeof fn === "function" ? fn : () => fn;

      const t0 = Number.isFinite(msg.timeSec) ? Number(msg.timeSec) : 0;
      const frame = normalizeFrame(activeDraw(t0));
      self.postMessage({
        type: "loaded",
        seq,
        slug: activeSlug,
        meta: activeMeta,
        frame,
      });
    } catch (err) {
      activeDraw = null;
      activeMeta = null;
      self.postMessage({
        type: "error",
        seq,
        error: err && err.message ? String(err.message) : "Failed to initialize piece",
      });
    }
    return;
  }

  if (msg.type === "frame") {
    if (!activeDraw || !activeMeta || (msg.slug && msg.slug !== activeSlug)) {
      self.postMessage({ type: "error", seq, error: "Piece not loaded" });
      return;
    }
    try {
      const t = Number.isFinite(msg.timeSec) ? Number(msg.timeSec) : 0;
      const frame = normalizeFrame(activeDraw(t));
      self.postMessage({
        type: "frame",
        seq,
        slug: activeSlug,
        frame,
      });
    } catch (err) {
      self.postMessage({
        type: "error",
        seq,
        error: err && err.message ? String(err.message) : "Frame compute failed",
      });
    }
  }
};
