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
  serverError: 'Could not reach the local server.',
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

  it('shows progress ring, auto-translate dot, and inline server error banner', () => {
    document.body.innerHTML = '<main><p>Hello world</p></main>';
    const state: FloatingMenuState = {
      active: true,
      display: 'replace',
      pending: 5,
      done: 5,
      total: 10,
      auto: 'always',
      targetLanguage: 'ja',
      serverFault: false,
    };
    const onOpenOptions = vi.fn();
    const controller = new FloatingMenuController(document, {
      labels: LABELS,
      preferences: { mode: 'on', position: { side: 'right', y: 70 }, uiLanguage: 'en' },
      callbacks: {
        onTogglePage: vi.fn(),
        onToggleBilingual: vi.fn(),
        onChangeTarget: vi.fn(),
        onToggleAlways: vi.fn(),
        onOpenTyped: vi.fn(),
        onOpenOptions,
        onPositionChange: vi.fn(),
        readState: () => state,
      },
      env: { isTopFrame: true },
    });

    const shadow = document.querySelector(FLOATING_MENU_TAG)!.shadowRoot!;
    const trigger = shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="trigger"]')!;
    const dot = shadow.querySelector<HTMLSpanElement>('[data-sakutto-fab="status-dot"]')!;
    const faultBanner = shadow.querySelector<HTMLDivElement>('[data-sakutto-fab="fault-banner"]')!;

    expect(trigger.getAttribute('data-progressing')).toBe('1');
    expect(trigger.style.getPropertyValue('--fab-progress')).toBe('50%');
    expect(dot.hidden).toBe(false);
    expect(dot.getAttribute('data-kind')).toBe('auto');
    expect(faultBanner.hidden).toBe(true);

    state.pending = 0;
    state.serverFault = true;
    controller.refresh();
    expect(trigger.getAttribute('data-progressing')).toBe('0');
    expect(dot.hidden).toBe(false);
    expect(dot.getAttribute('data-kind')).toBe('fault');

    trigger.click();
    expect(faultBanner.hidden).toBe(false);
    expect(faultBanner.textContent).toContain('Could not reach the local server.');
    shadow.querySelector<HTMLButtonElement>('[data-sakutto-fab="fault-options"]')!.click();
    expect(onOpenOptions).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it('hides the button for the current tab when swiped outward toward the docked edge', () => {
    document.body.innerHTML = '<main><p>Hello world</p></main>';
    const onPositionChange = vi.fn();
    const controller = new FloatingMenuController(document, {
      labels: LABELS,
      preferences: { mode: 'on', position: { side: 'right', y: 74 }, uiLanguage: 'en' },
      callbacks: {
        onTogglePage: vi.fn(),
        onToggleBilingual: vi.fn(),
        onChangeTarget: vi.fn(),
        onToggleAlways: vi.fn(),
        onOpenTyped: vi.fn(),
        onOpenOptions: vi.fn(),
        onPositionChange,
        readState: () => ({
          active: false,
          display: 'replace',
          pending: 0,
          done: 0,
          total: 0,
          auto: 'ask',
          targetLanguage: 'ja',
        }),
      },
      env: { isTopFrame: true },
    });

    const trigger = document
      .querySelector(FLOATING_MENU_TAG)!
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-sakutto-fab="trigger"]')!;

    trigger.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 350, clientY: 500 }),
    );
    trigger.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, button: 0, clientX: 405, clientY: 502 }),
    );
    trigger.dispatchEvent(
      new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: 405, clientY: 502 }),
    );

    expect(document.querySelector(FLOATING_MENU_TAG)).toBeNull();
    expect(onPositionChange).not.toHaveBeenCalled();

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
