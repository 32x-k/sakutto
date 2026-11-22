// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposeController, type ComposeLabels } from '@/dom/compose';
import { PageSession, type PageEngine } from '@/dom/session';
import type { OverlayLabels } from '@/dom/overlay';

vi.mock('wxt/browser', () => ({
  browser: {
    i18n: {
      getMessage: () => '',
    },
  },
}));

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

const COMPOSE_LABELS: ComposeLabels = {
  title: 'Draft translation',
  icon: 'Translate',
  replace: 'Replace',
  undo: 'Undo',
  close: 'Close',
  pending: 'Translating…',
  failed: 'Failed',
  empty: 'Empty',
  tooLong: 'Too long',
  swap: 'Swap',
  replaced: 'Replaced',
  stale: 'Stale',
  setup: 'Setup',
  loading: 'Loading',
  ineligible: 'Ineligible',
  openSetup: 'Open setup',
  target: 'Target',
  autoSource: 'Auto',
  replaceHint: (compose, enter) => `${compose} / ${enter}`,
  langPair: (source, target) => `${source} → ${target}`,
  into: (lang) => `Into ${lang}`,
  chromeOnly: (lang) => lang,
  placementMenu: 'Placement',
  placementSite: 'This site',
  placementFollowSettings: 'Follow settings',
  placementReset: 'Reset',
  placementHandle: 'Drag',
  placementLabel: (placement) => placement,
};

function stubEngine(): PageEngine {
  return {
    async *translate(segments) {
      for (const segment of segments) {
        yield { id: segment.id, final: `訳:${segment.text}`, engine: 'plamo' as const };
      }
    },
  };
}

const originalPushState = window.history.pushState;

afterEach(() => {
  window.history.pushState = originalPushState;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('runtime lightweight lifecycles', () => {
  it('defers MutationObserver and history patching until translate() and cleans them up on restore()', async () => {
    document.body.innerHTML = '<p>Hello world from Tokyo.</p>';

    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

    const session = new PageSession(document, {
      engine: stubEngine(),
      labels: LABELS,
      preferences: {
        targetLanguage: 'ja',
        targetExplicit: true,
        form: 'polite',
        display: 'replace',
        auto: 'ask',
        host: 'example.com',
        context: false,
        tier: null,
        pace: 'quality',
        engineSource: 'local-server',
      },
    });

    // Untranslated tab: no MutationObserver attached, history untouched.
    expect(observeSpy).not.toHaveBeenCalled();
    expect(window.history.pushState).toBe(originalPushState);

    await session.translate();
    await session.whenIdle();

    expect(observeSpy).toHaveBeenCalled();
    expect(window.history.pushState).not.toBe(originalPushState);

    session.restore();

    expect(disconnectSpy).toHaveBeenCalled();
    expect(window.history.pushState).toBe(originalPushState);

    session.dispose();
  });

  it('does not schedule animation frames on scroll in ComposeController when no field is focused', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const compose = new ComposeController(document, {
      engine: stubEngine(),
      labels: COMPOSE_LABELS,
      preferences: {
        enabled: true,
        showIcon: true,
        targetLanguage: 'en',
        explicitTarget: false,
        form: 'polite',
        instantReplace: false,
        placement: 'above',
        sitePlacement: null,
        freePoint: null,
        readiness: 'ready',
        replaceShortcut: '',
        uiLanguage: 'ja',
      },
    });

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(rafSpy).not.toHaveBeenCalled();

    compose.destroy();
  });
});
