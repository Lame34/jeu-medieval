/**
 * The address bar's switch for the end-to-end tests. `?e2e` installs Playwright's hooks
 * (`window.__battle`, `window.__battleCamera`), lets a test shorten the deadline (`?turns=N`) and
 * skips the briefing, the opening shot and the camera's following. It works on the dev server
 * only: a production build ignores it, so the deployed game exposes no way to drive or bend a
 * battle from the console.
 */
const query = (): URLSearchParams => (typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search));

export const E2E = import.meta.env.DEV && query().has('e2e');
