import "@testing-library/jest-dom";
import { afterEach } from "vitest";

// Pages keep view state (filters, toggles) on the history entry via
// useHistoryState; clear it so one test's state can't leak into the next.
afterEach(() => {
  window.history.replaceState(null, "");
});
