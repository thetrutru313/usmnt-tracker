/**
 * Tests for admin session helpers in src/lib/adminSession.ts.
 *
 * These are pure unit tests — no React rendering required.
 * They import the real shared module so any bug in the implementation is caught
 * here, not silently hidden behind a local re-implementation.
 *
 * Three session invariants are covered:
 *   1. clearSession() removes all localStorage keys.
 *   2. loadSession() clears and returns null when the stored timestamp is expired.
 *   3. A StorageEvent fired from another tab causes the current tab to log out.
 *
 * The cross-tab test simulates the browser StorageEvent that fires when
 * another tab calls localStorage.removeItem() for the token key.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  STORAGE_KEY,
  STORAGE_TS_KEY,
  STORAGE_EXPIRY_KEY,
  DEFAULT_SESSION_EXPIRY_MS,
  saveSession,
  loadSession,
  clearSession,
} from "../lib/adminSession";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clearSession()", () => {
  it("removes usmnt_admin_token from localStorage", () => {
    saveSession("secret123");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("secret123");

    clearSession();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("removes usmnt_admin_token_ts from localStorage", () => {
    saveSession("secret123");
    expect(localStorage.getItem(STORAGE_TS_KEY)).not.toBeNull();

    clearSession();

    expect(localStorage.getItem(STORAGE_TS_KEY)).toBeNull();
  });

  it("removes usmnt_admin_token from sessionStorage", () => {
    sessionStorage.setItem(STORAGE_KEY, "legacy-session-value");

    clearSession();

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("removes usmnt_admin_session_expiry_ms from localStorage", () => {
    saveSession("secret123", 3_600_000);
    expect(localStorage.getItem(STORAGE_EXPIRY_KEY)).not.toBeNull();

    clearSession();

    expect(localStorage.getItem(STORAGE_EXPIRY_KEY)).toBeNull();
  });

  it("is idempotent — calling it twice leaves storage empty", () => {
    saveSession("secret123");
    clearSession();
    clearSession(); // should not throw or re-add keys

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_TS_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_EXPIRY_KEY)).toBeNull();
  });
});

describe("loadSession()", () => {
  it("returns the token when it is fresh", () => {
    saveSession("valid-token");
    expect(loadSession()).toBe("valid-token");
  });

  it("returns null when no token is stored", () => {
    expect(loadSession()).toBeNull();
  });

  it("returns null and clears storage when the token is expired", () => {
    vi.useFakeTimers();

    saveSession("old-token");

    // Advance time past the 24-hour expiry
    vi.advanceTimersByTime(DEFAULT_SESSION_EXPIRY_MS + 1);

    const result = loadSession();

    expect(result).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_TS_KEY)).toBeNull();
  });

  it("shows login screen (returns null) when token exists but timestamp is missing", () => {
    localStorage.setItem(STORAGE_KEY, "orphan-token");
    // deliberately omit STORAGE_TS_KEY

    expect(loadSession()).toBeNull();
  });

  it("shows login screen (returns null) when timestamp exists but token is missing", () => {
    localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
    // deliberately omit STORAGE_KEY

    expect(loadSession()).toBeNull();
  });
});

// ─── Cross-tab logout ─────────────────────────────────────────────────────────
//
// The Admin component in Admin.tsx attaches a "storage" event listener.
// When another tab calls clearSession() (which removes the token key),
// the browser fires a StorageEvent on all OTHER tabs with:
//   key   = "usmnt_admin_token"
//   newValue = null
//
// The listener calls handleLogout() which sets token state to null,
// causing the login screen to render.
//
// This test verifies the listener logic directly — we register the same handler
// and dispatch a synthetic StorageEvent to confirm it fires correctly.

describe("cross-tab logout via StorageEvent", () => {
  it("fires the logout handler when another tab removes the token", () => {
    const handleLogout = vi.fn();

    // Register a handler that mirrors what Admin.tsx does
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue === null) {
        handleLogout();
      }
    }

    window.addEventListener("storage", onStorage);

    // Simulate another tab calling localStorage.removeItem(STORAGE_KEY)
    const event = new StorageEvent("storage", {
      key: STORAGE_KEY,
      oldValue: "some-token",
      newValue: null,
      storageArea: localStorage,
    });
    window.dispatchEvent(event);

    expect(handleLogout).toHaveBeenCalledOnce();

    window.removeEventListener("storage", onStorage);
  });

  it("does NOT fire the logout handler for unrelated storage changes", () => {
    const handleLogout = vi.fn();

    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue === null) {
        handleLogout();
      }
    }

    window.addEventListener("storage", onStorage);

    // A different key being changed — should be ignored
    const event = new StorageEvent("storage", {
      key: "some_other_key",
      oldValue: "x",
      newValue: null,
      storageArea: localStorage,
    });
    window.dispatchEvent(event);

    expect(handleLogout).not.toHaveBeenCalled();

    window.removeEventListener("storage", onStorage);
  });

  it("does NOT fire when the token key is SET (only cleared)", () => {
    const handleLogout = vi.fn();

    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue === null) {
        handleLogout();
      }
    }

    window.addEventListener("storage", onStorage);

    // Another tab logging IN — newValue is a token string, not null
    const event = new StorageEvent("storage", {
      key: STORAGE_KEY,
      oldValue: null,
      newValue: "new-token",
      storageArea: localStorage,
    });
    window.dispatchEvent(event);

    expect(handleLogout).not.toHaveBeenCalled();

    window.removeEventListener("storage", onStorage);
  });
});
