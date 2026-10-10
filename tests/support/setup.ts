import "@testing-library/jest-dom/vitest";

// Deterministic, valid test environment for server modules.
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.APP_ORIGIN ??= "http://localhost:3000";
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost/db";
process.env.HF_TOKEN ??= "hf_test_token";

if (typeof window !== "undefined") {
  // jsdom lacks these browser APIs used by components.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: typeof IO }).IntersectionObserver ??= IO;
}
