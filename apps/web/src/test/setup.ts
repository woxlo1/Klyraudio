import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest runs without global test APIs, so React Testing Library cannot
// register its own cleanup. Unmount rendered components between tests.
afterEach(() => {
  cleanup();
});
