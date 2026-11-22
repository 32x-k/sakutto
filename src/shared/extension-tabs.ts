import { browser } from 'wxt/browser';

/**
 * Focus an extension page that is already open, otherwise create it once. Settings actions
 * that need onboarding should not add another tab every time the reader presses the same
 * button; the existing tab keeps its live progress and license state.
 */
function absoluteUrl(pathOrUrl: string): string {
  return /^[a-z][a-z0-9+.-]*:/iu.test(pathOrUrl)
    ? pathOrUrl
    : browser.runtime.getURL(pathOrUrl as never);
}

const opening = new Map<string, Promise<number | null>>();

/**
 * Focus an extension page that is already open, otherwise create it once. Concurrent
 * callers for the same page (a command and the page hint can arrive together) join the
 * same query/create, so a grant prompt never ends up in two tabs.
 */
export function openOrFocusExtensionTab(pathOrUrl: string): Promise<number | null> {
  const url = absoluteUrl(pathOrUrl);
  const pending = opening.get(url);
  if (pending) return pending;

  const task = openOrFocusExtensionTabNow(url).finally(() => {
    if (opening.get(url) === task) opening.delete(url);
  });
  opening.set(url, task);
  return task;
}

async function openOrFocusExtensionTabNow(url: string): Promise<number | null> {
  const pattern = `${url.split(/[?#]/u)[0]}*`;

  try {
    const tabs = await browser.tabs.query({ url: pattern });
    const existing = tabs.find((tab) => tab.id !== undefined);
    if (existing?.id !== undefined) {
      // A query/hash names a section of an already-open page (for example the folder
      // picker). Keep it when focusing so the reader lands on that section, not the top.
      const update = /[?#]/u.test(url) ? { active: true, url } : { active: true };
      let focused = false;
      try {
        await browser.tabs.update(existing.id, update);
        focused = true;
      } catch {
        // The tab closed between the query and the focus. Open a replacement below.
      }
      if (focused) {
        if (existing.windowId !== undefined && browser.windows?.update) {
          await browser.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
        }
        return existing.id;
      }
    }
  } catch {
    // Not every page can query tabs (or has the tabs API in a test). Falling through still
    // opens the page exactly once.
  }

  try {
    const created = await browser.tabs.create({ url });
    return created.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Open or focus the extension's Settings page (`options.html`).
 *
 * Uses `openOrFocusExtensionTab` first rather than `browser.runtime.openOptionsPage()`,
 * because Firefox for Android (Fenix) fails to open or focus `options.html` when
 * `openOptionsPage()` is called from an extension popup or tab. Falls back to
 * `browser.runtime.openOptionsPage()` when the tabs API is unavailable.
 */
export async function openOptionsPage(suffix = ''): Promise<boolean> {
  const opened = await openOrFocusExtensionTab(`/options.html${suffix}`);
  if (opened !== null) return true;
  if (typeof browser.runtime?.openOptionsPage !== 'function') return false;
  try {
    await browser.runtime.openOptionsPage();
    return true;
  } catch {
    return false;
  }
}
