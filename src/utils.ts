/**
 * Web Audio API synthesizer for instant, zero-latency audio alerts
 * without relying on external assets.
 */
export function playNotificationSound(type: "request" | "message" | "success") {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "request") {
      // Elegant multi-tone electronic chime
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24); // G5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } else if (type === "message") {
      // Quick organic pop sound
      osc.type = "sine";
      osc.frequency.setValueAtTime(580, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(750, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "success") {
      // Pleasant high-pitch double chime
      osc.type = "triangle";
      osc.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.warn("Audio feedback blocked by browser autoplay policy:", e);
  }
}

/**
 * Format bytes to human readable format
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

/**
 * Generates an initial letter based on user's name
 */
export function getInitials(name: string): string {
  if (!name) return "?";
  return name.split(" ").map(p => p[0]).join("").toUpperCase().substring(0, 2);
}

/**
 * Generates a vibrant UI gradient from a seed string
 */
export function getAvatarGradient(seed: string): string {
  const safeSeed = seed || "default";
  const hash = safeSeed.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  const colors = [
    ["from-indigo-500 to-purple-600", "from-indigo-600 to-indigo-800"],
    ["from-emerald-400 to-teal-600", "from-teal-500 to-teal-700"],
    ["from-violet-500 to-fuchsia-600", "from-violet-600 to-violet-800"],
    ["from-rose-400 to-orange-500", "from-rose-500 to-rose-700"],
    ["from-cyan-400 to-blue-600", "from-cyan-500 to-blue-700"],
    ["from-amber-400 to-pink-500", "from-amber-500 to-amber-700"]
  ];

  const index = Math.abs(hash) % colors.length;
  return colors[index][0];
}

/**
 * Helper to check file size limits (configurable, e.g. 15MB)
 */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * Resolves full API URL with fallback to local relative route
 */
export function getApiUrl(path: string): string {
  const base = (import.meta as any).env.VITE_API_URL || "";
  // Ensure we don't double slash if path starts with one
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

/**
 * Resolves WebSocket URL with fallback to current origin
 */
export function getWsUrl(): string {
  const customWs = (import.meta as any).env.VITE_WS_URL;
  if (customWs) return customWs;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}
