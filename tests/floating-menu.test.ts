// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: {
    i18n: {
      getMessage: () => '',
      getUILanguage: () => 'en',
    },
  },
}));

import { isOwnUi } from '@/dom/blocks';
import {
  FLOATING_MENU_TAG,
  FloatingMenuController,
  shouldShowFloatingButton,
  type FloatingMenuLabels,
  type FloatingMenuState,
} from '@/dom/floating-menu';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, normalizeSettings } from '@/shared/settings';

const LABELS: FloatingMenuLabels = {
  brand: 'Sakutto',
  translatePage: 'Translate this page',
  restorePage: 'Restore the original',
  displayReplace: 'Replace original',
  displayBilingual: 'Bilingual',
  targetLabel: 'Translate into',
  alwaysSite: 'Always translate this site',
  openTyped: 'Translate typed text',
  openOptions: 'Open settings',
  hideTab: 'Hide on this page',
  close: 'Close',
  pageTranslated: 'This page is translated.',
  pageProgress: (done, total) => `Translating ${done} / ${total}`,
};

describe('shouldShowFloatingButton', () => {
  it('stays off on desktop in auto mode', () => {
    expect(
      shouldShowFloatingButton('auto', {
        isTopFrame: true,
        innerWidth: 1440,
        navigator: {
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:153.0) Gecko/20100101 Firefox/153.0',
        },
        matchMedia: () => ({ matches: false }),
      }),
    ).toBe(false);
  });

  it('activates automatically on Android', () => {
    expect(
      shouldShowFloatingButton('auto', {
        isTopFrame: true,
        innerWidth: 412,
        navigator: {
          userAgent: 'Mozilla/5.0 (Android 15; Mobile; rv:163.0) Gecko/163.0 Firefox/163.0',
        },
        matchMedia: () => ({ matches: false }),
      }),
    ).toBe(true);
  });

  it('activates automatically on narrow coarse-pointer touch screens', () => {
    expect(
      shouldShowFloatingButton('auto', {
        isTopFrame: true,
        innerWidth: 390,
        navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' },
        matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }),
      }),
    ).toBe(true);
  });

  it('honors explicit on/off modes and never mounts inside iframes', () => {
    expect(shouldShowFloatingButton('on', { isTopFrame: true, innerWidth: 1920 })).toBe(true);
    expect(
      shouldShowFloatingButton('off', {
        isTopFrame: true,
        navigator: { userAgent: 'Mozilla/5.0 (Android 15; Mobile)' },
      }),
    ).toBe(false);
    expect(shouldShowFloatingButton('on', { isTopFrame: false })).toBe(false);
  });
});

describe('FloatingMenuController', () => {
  it('mounts shadow UI, marks it as own UI, and invokes all quick-menu actions', () => {
    document.body.innerHTML = '<main><p>Hello world</p></main>';
    const state: FloatingMenuState = {
      active: false,
      display: 'replace',
      pending: 0,
      done: 0,
      total: 0,
      auto: 'ask',
      targetLanguage: 'ja',
    };
    const callbacks = {
      onTogglePage: vi.fn(() => {
        state.active = !state.active;
      }),
      onToggleBilingual: vi.fn(() => {
        state.display = state.display === 'replace' ? 'bilingual' : 'replace';
      }),
      onChangeTarget: vi.fn(),
      onToggleAlways: vi.fn(),
      onOpenTyped: vi.fn(),
      onOpenOptions: vi.fn(),
      onPositionChange: vi.fn(),
      readState: () => state,
    };

    const controller = new FloatingMenuController(document, {
      labels: LABELS,
      preferences: { mode: 'on', position: null, uiLanguage: 'en' },
      callbacks,
      env: { isTopFrame: true },
    });

    const host = document.querySelector(FLOATING_MENU_TAG);
    expect(host).not.toBeNull();
    expect(isOwnUi(host!)).toBe(true);

    const shadow = host!.shadowRoot!;
    const trigger = shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="trigger"]')!;
    const sheet = shadow.querySelector<HTMLDivElement>('[data-sakutto-fab="sheet"]')!;
    expect(sheet.hidden).toBe(true);

    // Open menu
    trigger.click();
    expect(sheet.hidden).toBe(false);

    // Toggle page translation
    const toggleBtn = shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="toggle-page"]')!;
    expect(toggleBtn.textContent).toBe('Translate this page');
    toggleBtn.click();
    expect(callbacks.onTogglePage).toHaveBeenCalledTimes(1);
    expect(sheet.hidden).toBe(true);
    expect(trigger.getAttribute('data-active')).toBe('1');

    // Re-open menu and verify restore label + bilingual + target + always + options + typed
    trigger.click();
    expect(toggleBtn.textContent).toBe('Restore the original');

    shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="toggle-bilingual"]')!.click();
    expect(callbacks.onToggleBilingual).toHaveBeenCalledTimes(1);

    const select = shadow.querySelector<HTMLSelectElement>('[data-sakutto-fab="target-language"]')!;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    expect(callbacks.onChangeTarget).toHaveBeenCalledWith('en');

    const always = shadow.querySelector<HTMLInputElement>('[data-sakutto-fab="always-site"]')!;
    always.checked = true;
    always.dispatchEvent(new Event('change'));
    expect(callbacks.onToggleAlways).toHaveBeenCalledWith(true);

    shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="open-options"]')!.click();
    expect(callbacks.onOpenOptions).toHaveBeenCalledTimes(1);
    expect(sheet.hidden).toBe(true);

    trigger.click();
    shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="open-typed"]')!.click();
    expect(callbacks.onOpenTyped).toHaveBeenCalledTimes(1);

    // Hide on this tab removes host
    trigger.click();
    shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="hide-tab"]')!.click();
    expect(document.querySelector(FLOATING_MENU_TAG)).toBeNull();

    controller.dispose();
  });
});

describe('floating button settings normalization', () => {
  it('defaults to auto mode and clamps stored positions', () => {
    expect(DEFAULT_SETTINGS.floatingButton).toBe('auto');
    expect(DEFAULT_SETTINGS.floatingButtonPosition).toBeNull();

    const normalized = normalizeSettings(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        floatingButton: 'on',
        floatingButtonPosition: { side: 'left', y: 120 },
      },
      'ja',
    );
    expect(normalized.floatingButton).toBe('on');
    expect(normalized.floatingButtonPosition).toEqual({ side: 'left', y: 92 });

    const fallback = normalizeSettings(
      {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        floatingButton: 'bogus',
        floatingButtonPosition: { side: 'right', y: Number.NaN },
      },
      'en',
    );
    expect(fallback.floatingButton).toBe('auto');
    expect(fallback.floatingButtonPosition).toBeNull();
  });
});
