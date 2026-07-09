import "@testing-library/jest-dom/vitest";

Object.defineProperty(globalThis, "IntersectionObserver", {
  value: class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
  writable: true,
  configurable: true,
});
