/**
 * security.ts — Instant07 Frontend Security Utilities
 * =====================================================
 * Provides XSS sanitization, input validation, file safety checks,
 * and clickjacking protection for all user-facing interactions.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max length for any free-text user input (chat messages, names) */
const MAX_TEXT_LENGTH = 8000;

/** Max file name length */
const MAX_FILENAME_LENGTH = 255;

/** UUID v4 regex — used to validate session IDs and room IDs */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Room ID prefix format: "room-<uuid>" */
const ROOM_ID_REGEX = /^room-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Allowlist of safe MIME types for file upload */
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "image/bmp", "image/tiff", "image/avif",
  // Audio
  "audio/mpeg", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4",
  "audio/aac", "audio/flac",
  // Video
  "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/avi",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain", "text/csv", "text/markdown",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  // Generic binary (used as fallback)
  "application/octet-stream",
]);

/** Characters that are dangerous in NoSQL DB keys (Firebase path segments) */
const NOSQL_DANGEROUS_CHARS = /[$\.#\[\]/]/g;

// ─── XSS Sanitization ─────────────────────────────────────────────────────────

/**
 * Strips dangerous HTML/script tags and event attributes from user input.
 * Use before sending any user-typed text to the server.
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== "string") return "";

  return input
    // Truncate to safe length
    .slice(0, MAX_TEXT_LENGTH)
    // Remove null bytes (common in injection attacks)
    .replace(/\0/g, "")
    // Strip <script> blocks entirely
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    // Strip dangerous HTML tags
    .replace(/<(iframe|object|embed|form|input|button|link|meta|base|style)[^>]*>/gi, "")
    // Remove inline event handlers (onclick, onerror, onload, etc.)
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "")
    // Remove javascript: and data: URI schemes
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:/gi, "")
    // Remove vbscript:
    .replace(/vbscript\s*:/gi, "")
    // Trim
    .trim();
}

/**
 * Escapes HTML special characters to prevent XSS when rendering content.
 */
export function escapeHtml(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

// ─── ID Validation ────────────────────────────────────────────────────────────

/**
 * Returns true if the given string is a valid UUID v4.
 * Use before sending sessionId to any API endpoint or WebSocket message.
 */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && UUID_REGEX.test(id);
}

/**
 * Returns true if the given string is a valid Room ID (room-<uuid>).
 */
export function isValidRoomId(id: unknown): id is string {
  return typeof id === "string" && ROOM_ID_REGEX.test(id);
}

// ─── File Safety ──────────────────────────────────────────────────────────────

/**
 * Sanitizes a file name:
 * - Strips path traversal sequences
 * - Removes null bytes and control characters
 * - Limits length to 255 characters
 * - Strips leading dots (hidden files on Unix)
 */
export function sanitizeFileName(name: string): string {
  if (typeof name !== "string" || !name) return "unnamed_file";

  return (
    name
      // Remove any directory separators (path traversal prevention)
      .replace(/[/\\]/g, "_")
      // Remove null bytes and control characters
      .replace(/[\0\x01-\x1f\x7f]/g, "")
      // Remove leading dots (hidden files)
      .replace(/^\.+/, "")
      // Trim length
      .slice(0, MAX_FILENAME_LENGTH)
      .trim() || "unnamed_file"
  );
}

/**
 * Returns true if the MIME type is in the allowlist.
 */
export function isAllowedMimeType(mimeType: string): boolean {
  if (typeof mimeType !== "string") return false;
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return ALLOWED_MIME_TYPES.has(normalized);
}

/**
 * Validates a file before upload. Returns an error message string if invalid,
 * or null if the file passes all checks.
 */
export function validateFile(file: File, maxSizeBytes: number): string | null {
  if (!file) return "No file provided.";

  if (!isAllowedMimeType(file.type)) {
    return `File type "${file.type}" is not allowed.`;
  }

  if (file.size > maxSizeBytes) {
    const mb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return `File exceeds the ${mb}MB size limit.`;
  }

  const safeName = sanitizeFileName(file.name);
  if (!safeName || safeName === "unnamed_file") {
    return "Invalid file name.";
  }

  return null;
}

// ─── NoSQL Injection Prevention ───────────────────────────────────────────────

/**
 * Strips characters dangerous in Firebase RTDB key paths: $, ., #, [, ], /
 */
export function sanitizeDbKey(key: string): string {
  if (typeof key !== "string") return "";
  return key.replace(NOSQL_DANGEROUS_CHARS, "_").slice(0, 128);
}

/**
 * Returns true if a string is safe to use as a Firebase DB key.
 */
export function isValidDbKey(key: string): boolean {
  if (typeof key !== "string" || !key) return false;
  return !NOSQL_DANGEROUS_CHARS.test(key) && key.length <= 128;
}

// ─── Clickjacking Prevention ─────────────────────────────────────────────────

/**
 * Call once on app startup. Detects if the app is loaded inside an iframe
 * and breaks out of it to prevent clickjacking attacks.
 */
export function preventClickjacking(): void {
  try {
    if (window.self !== window.top) {
      window.top!.location.href = window.self.location.href;
    }
  } catch {
    // Cross-origin iframe: hide body as fallback
    document.body.style.display = "none";
  }
}

// ─── URL Validation ───────────────────────────────────────────────────────────

/**
 * Returns true if a URL is safe (http/https only).
 * Blocks javascript:, data:, vbscript: schemes.
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ─── Client-Side Rate Limiter ─────────────────────────────────────────────────

/**
 * Creates a simple client-side rate limiter.
 * Returns a wrapped version of `fn` that only executes at most
 * `maxCalls` times per `windowMs` milliseconds.
 */
export function createRateLimiter(maxCalls: number, windowMs: number) {
  const timestamps: number[] = [];

  return function rateLimited<T extends (...args: unknown[]) => unknown>(
    fn: T
  ): (...args: Parameters<T>) => ReturnType<T> | null {
    return (...args: Parameters<T>): ReturnType<T> | null => {
      const now = Date.now();
      while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
        timestamps.shift();
      }
      if (timestamps.length >= maxCalls) {
        console.warn(`[Security] Rate limit: max ${maxCalls} calls per ${windowMs}ms`);
        return null;
      }
      timestamps.push(now);
      return fn(...args) as ReturnType<T>;
    };
  };
}
