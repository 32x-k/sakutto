// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBarTheme,
  applyFabTheme,
  contrastRatio,
  ensureAccentContrast,
  parseCssColor,
  samplePageTheme,
} from '@/dom/page-theme';
import { PageOverlay, uiShadow, type OverlayLabels } from '@/dom/overlay';

const LABELS: OverlayLabels = {
  original: 'Original',
  chromeNote: 'Chrome built-in translation',
  machine: 'Machine translation by PLaMo.',
  selectionPending: 'Translating…',
  selectionFailed: 'Could not translate this selection.',
  selectionTitle: 'Selected text',
  selectionIcon: 'Translate selection',
  selectionResize: 'Resize popup',
  selectionCopy: 'Copy translation',
  selectionCopied: 'Copied',
  selectionCopyFailed: 'Copy failed',
  close: 'Close',
  bilingualOn: 'Bilingual',
  replaceOn: 'Replace',
  barLabel: 'Translation progress',
  barProgress: (done, total) => `${String(done)} / ${String(total)}`,
  barRate: (tokens, segments) => `${tokens} tok/s · ${segments} seg/s`,
  barDone: 'Translated',
  barPartial: (blocks) => `${String(blocks)} untranslated`,
  modelMissing: 'Model missing',
  barOriginal: 'Original',
  barAlways: 'Always',
  barAlwaysOn: 'Always on',
};

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.style.cssText = '';
  document.body.style.cssText = '';
  vi.useRealTimers();
});

describe('page theme sampling', () => {
  it('parses hex, rgb, rgba, and slash-alpha colors cleanly', () => {
    expect(parseCssColor('#0f172a')).toEqual({ r: 15, g: 23, b: 42, a: 1 });
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseCssColor('rgb(22, 27, 34)')).toEqual({ r: 22, g: 27, b: 34, a: 1 });
    expect(parseCssColor('rgba(246, 241, 231, 0.9)')).toEqual({
      r: 246,
      g: 241,
      b: 231,
      a: 0.9,
    });
    expect(parseCssColor('rgb(15 23 42 / 50%)')).toEqual({ r: 15, g: 23, b: 42, a: 0.5 });
    expect(parseCssColor('transparent')).toBeNull();
  });

  it('samples dark pages, meta theme-color, and link accents with guaranteed contrast', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#0d1117">';
    document.body.style.backgroundColor = 'rgb(13, 17, 23)';
    document.body.innerHTML =
      '<main><a href="https://example.com" style="color: rgb(88, 166, 255)">Link</a></main>';

    const theme = samplePageTheme(document);
    expect(theme.dark).toBe(true);
    expect(theme.headerDark).toBe(true);
    expect(theme.header).toEqual({ r: 13, g: 17, b: 23 });
    expect(contrastRatio(theme.accent, theme.header)).toBeGreaterThanOrEqual(3.2);

    const barHost = document.createElement('div');
    applyBarTheme(barHost, theme);
    expect(barHost.style.getPropertyValue('--bar-bg')).toContain('rgba(');
    expect(barHost.style.getPropertyValue('--bar-text')).toBe('rgb(241, 245, 249)');

    const fabHost = document.createElement('div');
    applyFabTheme(fabHost, theme);
    expect(fabHost.style.getPropertyValue('--fab-bg')).toContain('rgba(');
    expect(fabHost.style.getPropertyValue('--fab-accent-bg')).toContain('rgba(');
  });

  it('adjusts low-contrast accents to stay legible against the background', () => {
    const adjusted = ensureAccentContrast({ r: 245, g: 245, b: 250 }, { r: 255, g: 255, b: 255 });
    expect(contrastRatio(adjusted, { r: 255, g: 255, b: 255 })).toBeGreaterThanOrEqual(3.2);
  });
});

describe('PageOverlay adaptive progress bar', () => {
  it('updates progress width, adapts to page theme, and auto-hides after clean completion', () => {
    vi.useFakeTimers();
    document.body.style.backgroundColor = 'rgb(246, 241, 231)';

    const overlay = new PageOverlay(document, LABELS);
    overlay.showBar({
      text: 'Translating 5 / 10',
      original: 'Original',
      always: 'Always',
      alwaysEnabled: true,
      status: 'translating',
      progress: 0.5,
    });

    const bar = document.querySelector<HTMLElement>('sakutto-bar')!;
    const shadow = uiShadow(bar)!;
    const fill = shadow.querySelector<HTMLElement>('.progress-fill')!;
    expect(bar.hidden).toBe(false);
    expect(fill.style.width).toBe('50%');
    expect(bar.style.getPropertyValue('--bar-bg')).toContain('rgba(');

    overlay.showBar({
      text: 'Translated',
      original: 'Original',
      always: 'Always',
      alwaysEnabled: true,
      status: 'done',
      progress: 1,
    });
    expect(fill.style.width).toBe('100%');
    expect(bar.hidden).toBe(false);

    // Still visible right before auto-hide completes, then cleanly hidden & padding restored.
    vi.advanceTimersByTime(3_400);
    expect(bar.hidden).toBe(false);

    vi.advanceTimersByTime(500);
    expect(bar.hidden).toBe(true);
    expect(document.documentElement.style.paddingTop).toBe('');

    overlay.destroy();
  });

  it('keeps partial/error bars visible until dismissed manually', () => {
    vi.useFakeTimers();
    const overlay = new PageOverlay(document, LABELS);
    overlay.showBar({
      text: '1 untranslated',
      original: 'Original',
      always: 'Always',
      alwaysEnabled: true,
      status: 'partial',
      progress: 0.8,
    });

    const bar = document.querySelector<HTMLElement>('sakutto-bar')!;
    vi.advanceTimersByTime(10_000);
    expect(bar.hidden).toBe(false);

    const closeBtn = uiShadow(bar)?.querySelector<HTMLButtonElement>('.close-btn');
    closeBtn?.click();
    vi.advanceTimersByTime(300);
    expect(bar.hidden).toBe(true);

    overlay.destroy();
  });
});
