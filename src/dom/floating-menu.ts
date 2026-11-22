import { isAndroidPlatform, type PlatformNavigator } from '@/shared/browser';
import {
  JA_EASY_TARGET,
  SUPPORTED_LANGUAGES,
  isTargetLanguage,
  type TargetLanguage,
} from '@/shared/languages';
import type {
  DisplayMode,
  FloatingButtonMode,
  FloatingButtonPosition,
  FloatingButtonSide,
} from '@/shared/settings';
import { displayTargetLanguage } from '@/ui/language-label';
import type { SiteAuto } from './sites';

export const FLOATING_MENU_TAG = 'sakutto-fab';
const DEFAULT_POSITION: FloatingButtonPosition = { side: 'right', y: 74 };
const DRAG_THRESHOLD_PX = 8;

export interface FloatingMenuEnv {
  readonly navigator?: PlatformNavigator | undefined;
  readonly innerWidth?: number | undefined;
  readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined;
  readonly isTopFrame?: boolean | undefined;
}

/**
 * Decides whether the in-page floating quick menu should mount.
 * `auto` activates on Android and touch-primary mobile viewports so desktop pages stay clean.
 */
export function shouldShowFloatingButton(
  mode: FloatingButtonMode,
  env: FloatingMenuEnv = {},
): boolean {
  const isTopFrame =
    env.isTopFrame ?? (typeof window === 'undefined' ? true : window.top === window.self);
  if (!isTopFrame) return false;
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  const nav =
    env.navigator ??
    (typeof navigator === 'undefined' ? undefined : (navigator as PlatformNavigator));
  if (isAndroidPlatform(nav)) return true;
  const width = env.innerWidth ?? (typeof window === 'undefined' ? 1280 : window.innerWidth);
  const mm =
    env.matchMedia ?? (typeof window === 'undefined' ? undefined : window.matchMedia?.bind(window));
  const coarse = Boolean(mm?.('(pointer: coarse)')?.matches);
  return coarse && width <= 1024;
}

export interface FloatingMenuLabels {
  brand: string;
  translatePage: string;
  restorePage: string;
  displayReplace: string;
  displayBilingual: string;
  targetLabel: string;
  alwaysSite: string;
  openTyped: string;
  openOptions: string;
  hideTab: string;
  close: string;
  pageTranslated: string;
  pageProgress: (done: number, total: number) => string;
}

export interface FloatingMenuState {
  active: boolean;
  display: DisplayMode;
  pending: number;
  done: number;
  total: number;
  auto: SiteAuto;
  targetLanguage: TargetLanguage;
}

export interface FloatingMenuPreferences {
  mode: FloatingButtonMode;
  position: FloatingButtonPosition | null;
  uiLanguage: string;
}

export interface FloatingMenuCallbacks {
  onTogglePage: () => void;
  onToggleBilingual: () => void;
  onChangeTarget: (language: TargetLanguage) => void;
  onToggleAlways: (always: boolean) => void;
  onOpenTyped: () => void;
  onOpenOptions: () => void;
  onPositionChange: (position: FloatingButtonPosition) => void;
  readState: () => FloatingMenuState;
}

const TARGET_OPTIONS: readonly TargetLanguage[] = [
  SUPPORTED_LANGUAGES[0],
  JA_EASY_TARGET,
  ...SUPPORTED_LANGUAGES.slice(1),
];

const FAB_STYLE = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483645;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', sans-serif;
  color-scheme: light dark;
  --bg: rgba(255, 255, 255, 0.96);
  --surface: #f4f7f8;
  --text: #0f172a;
  --muted: #526071;
  --border: rgba(15, 23, 42, 0.14);
  --accent: #0f766e;
  --accent-strong: #115e59;
  --accent-contrast: #ffffff;
  --shadow: 0 8px 24px rgba(15, 23, 42, 0.22);
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: rgba(22, 27, 34, 0.96);
    --surface: #212832;
    --text: #f1f5f9;
    --muted: #94a3b8;
    --border: rgba(241, 245, 249, 0.16);
    --accent: #14b8a6;
    --accent-strong: #2dd4bf;
    --accent-contrast: #042f2e;
    --shadow: 0 8px 26px rgba(0, 0, 0, 0.48);
  }
}
* { box-sizing: border-box; }
.fab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 44px;
  height: 44px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--accent);
  box-shadow: var(--shadow);
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-size: 12px;
  font-weight: 700;
  transition: transform 0.12s ease, background 0.15s ease, color 0.15s ease;
}
.fab-btn:active {
  transform: scale(0.95);
}
.fab-btn[data-active="1"] {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: transparent;
}
.fab-btn svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.badge {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.sheet {
  position: fixed;
  width: min(296px, calc(100vw - 24px));
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  box-shadow: var(--shadow);
  display: grid;
  gap: 10px;
  font-size: 13px;
  line-height: 1.4;
}
.sheet[hidden] {
  display: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.icon-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.primary {
  width: 100%;
  min-height: 42px;
  padding: 9px 14px;
  border: none;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.status {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.status[hidden] {
  display: none;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.btn {
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.field {
  display: grid;
  gap: 4px;
}
.field span {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}
.field select {
  width: 100%;
  min-height: 38px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}
.check input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
.link {
  border: none;
  background: transparent;
  color: var(--accent-strong);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 2px;
  cursor: pointer;
}
.link.muted {
  color: var(--muted);
  font-weight: 500;
}
`;

export class FloatingMenuController {
  private readonly doc: Document;
  private labels: FloatingMenuLabels;
  private prefs: FloatingMenuPreferences;
  private readonly callbacks: FloatingMenuCallbacks;
  private readonly env: FloatingMenuEnv;

  private host: HTMLElement | null = null;
  private fabButton: HTMLButtonElement | null = null;
  private badgeEl: HTMLSpanElement | null = null;
  private sheetEl: HTMLDivElement | null = null;
  private titleEl: HTMLSpanElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private primaryBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLParagraphElement | null = null;
  private displayBtn: HTMLButtonElement | null = null;
  private typedBtn: HTMLButtonElement | null = null;
  private targetLabelEl: HTMLSpanElement | null = null;
  private targetSelect: HTMLSelectElement | null = null;
  private alwaysInput: HTMLInputElement | null = null;
  private alwaysTextEl: HTMLSpanElement | null = null;
  private optionsBtn: HTMLButtonElement | null = null;
  private hideBtn: HTMLButtonElement | null = null;

  private open = false;
  private hiddenForTab = false;
  private disposed = false;
  private position: FloatingButtonPosition = DEFAULT_POSITION;
  private pollTimer = 0;

  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragOffsetY = 0;
  private dragged = false;

  constructor(
    doc: Document,
    options: {
      labels: FloatingMenuLabels;
      preferences: FloatingMenuPreferences;
      callbacks: FloatingMenuCallbacks;
      env?: FloatingMenuEnv;
    },
  ) {
    this.doc = doc;
    this.labels = options.labels;
    this.prefs = options.preferences;
    this.callbacks = options.callbacks;
    this.env = options.env ?? {};
    this.position = options.preferences.position ?? DEFAULT_POSITION;
    this.syncMount();
  }

  setLabels(labels: FloatingMenuLabels): void {
    this.labels = labels;
    this.render();
  }

  setPreferences(preferences: FloatingMenuPreferences): void {
    this.prefs = preferences;
    if (preferences.position) this.position = preferences.position;
    this.syncMount();
    this.applyPosition();
    this.render();
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unmount();
  }

  private syncMount(): void {
    if (this.disposed) return;
    const visible = !this.hiddenForTab && shouldShowFloatingButton(this.prefs.mode, this.env);
    if (visible && !this.host) {
      this.mount();
    } else if (!visible && this.host) {
      this.unmount();
    }
  }

  private mount(): void {
    const parent = this.doc.documentElement ?? this.doc.body;
    if (!parent) return;

    const host = this.doc.createElement(FLOATING_MENU_TAG);
    host.setAttribute('translate', 'no');
    const shadow = host.attachShadow({ mode: 'open' });

    const style = this.doc.createElement('style');
    style.textContent = FAB_STYLE;
    shadow.appendChild(style);

    const fab = this.doc.createElement('button');
    fab.type = 'button';
    fab.className = 'fab-btn';
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('data-sakutto-fab', 'trigger');
    fab.appendChild(this.createIconSvg());

    const badge = this.doc.createElement('span');
    badge.className = 'badge';
    badge.hidden = true;
    fab.appendChild(badge);

    const sheet = this.doc.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('data-sakutto-fab', 'sheet');
    sheet.hidden = true;

    const header = this.doc.createElement('div');
    header.className = 'header';
    const title = this.doc.createElement('span');
    title.className = 'title';
    const closeBtn = this.doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this.setOpen(false));
    header.append(title, closeBtn);

    const primaryBtn = this.doc.createElement('button');
    primaryBtn.type = 'button';
    primaryBtn.className = 'primary';
    primaryBtn.setAttribute('data-sakutto-fab', 'toggle-page');
    primaryBtn.addEventListener('click', () => {
      this.callbacks.onTogglePage();
      this.setOpen(false);
      this.ensurePoll();
      this.render();
    });

    const statusEl = this.doc.createElement('p');
    statusEl.className = 'status';
    statusEl.hidden = true;

    const row = this.doc.createElement('div');
    row.className = 'row';
    const displayBtn = this.doc.createElement('button');
    displayBtn.type = 'button';
    displayBtn.className = 'btn';
    displayBtn.setAttribute('data-sakutto-fab', 'toggle-bilingual');
    displayBtn.addEventListener('click', () => {
      this.callbacks.onToggleBilingual();
      this.render();
    });
    const typedBtn = this.doc.createElement('button');
    typedBtn.type = 'button';
    typedBtn.className = 'btn';
    typedBtn.setAttribute('data-sakutto-fab', 'open-typed');
    typedBtn.addEventListener('click', () => {
      this.setOpen(false);
      this.callbacks.onOpenTyped();
    });
    row.append(displayBtn, typedBtn);

    const targetField = this.doc.createElement('label');
    targetField.className = 'field';
    const targetLabel = this.doc.createElement('span');
    const targetSelect = this.doc.createElement('select');
    targetSelect.setAttribute('data-sakutto-fab', 'target-language');
    targetSelect.addEventListener('change', () => {
      if (isTargetLanguage(targetSelect.value)) {
        this.callbacks.onChangeTarget(targetSelect.value);
      }
    });
    targetField.append(targetLabel, targetSelect);

    const alwaysLabel = this.doc.createElement('label');
    alwaysLabel.className = 'check';
    const alwaysInput = this.doc.createElement('input');
    alwaysInput.type = 'checkbox';
    alwaysInput.setAttribute('data-sakutto-fab', 'always-site');
    alwaysInput.addEventListener('change', () => {
      this.callbacks.onToggleAlways(alwaysInput.checked);
    });
    const alwaysText = this.doc.createElement('span');
    alwaysLabel.append(alwaysInput, alwaysText);

    const footer = this.doc.createElement('div');
    footer.className = 'footer';
    const optionsBtn = this.doc.createElement('button');
    optionsBtn.type = 'button';
    optionsBtn.className = 'link';
    optionsBtn.setAttribute('data-sakutto-fab', 'open-options');
    optionsBtn.addEventListener('click', () => {
      this.setOpen(false);
      this.callbacks.onOpenOptions();
    });
    const hideBtn = this.doc.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'link muted';
    hideBtn.setAttribute('data-sakutto-fab', 'hide-tab');
    hideBtn.addEventListener('click', () => {
      this.hiddenForTab = true;
      this.setOpen(false);
      this.unmount();
    });
    footer.append(optionsBtn, hideBtn);

    sheet.append(header, primaryBtn, statusEl, row, targetField, alwaysLabel, footer);
    shadow.append(fab, sheet);

    fab.addEventListener('pointerdown', this.onPointerDown);
    fab.addEventListener('pointermove', this.onPointerMove);
    fab.addEventListener('pointerup', this.onPointerUp);
    fab.addEventListener('pointercancel', this.onPointerCancel);
    fab.addEventListener('click', this.onFabClick);

    this.doc.addEventListener('pointerdown', this.onDocPointerDown, true);
    this.doc.addEventListener('keydown', this.onDocKeyDown, true);
    this.doc.defaultView?.addEventListener('resize', this.onResize);

    parent.appendChild(host);

    this.host = host;
    this.fabButton = fab;
    this.badgeEl = badge;
    this.sheetEl = sheet;
    this.titleEl = title;
    this.closeBtn = closeBtn;
    this.primaryBtn = primaryBtn;
    this.statusEl = statusEl;
    this.displayBtn = displayBtn;
    this.typedBtn = typedBtn;
    this.targetLabelEl = targetLabel;
    this.targetSelect = targetSelect;
    this.alwaysInput = alwaysInput;
    this.alwaysTextEl = alwaysText;
    this.optionsBtn = optionsBtn;
    this.hideBtn = hideBtn;

    this.applyPosition();
    this.render();
  }

  private unmount(): void {
    this.stopPoll();
    this.doc.removeEventListener('pointerdown', this.onDocPointerDown, true);
    this.doc.removeEventListener('keydown', this.onDocKeyDown, true);
    this.doc.defaultView?.removeEventListener('resize', this.onResize);
    this.host?.remove();
    this.host = null;
    this.fabButton = null;
    this.badgeEl = null;
    this.sheetEl = null;
    this.titleEl = null;
    this.closeBtn = null;
    this.primaryBtn = null;
    this.statusEl = null;
    this.displayBtn = null;
    this.typedBtn = null;
    this.targetLabelEl = null;
    this.targetSelect = null;
    this.alwaysInput = null;
    this.alwaysTextEl = null;
    this.optionsBtn = null;
    this.hideBtn = null;
    this.open = false;
  }

  private createIconSvg(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = this.doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const paths = [
      'M5 8l6 6',
      'M4 14l6-6 2-3',
      'M2 5h12',
      'M7 2h1',
      'M22 22l-5-10-5 10',
      'M14 18h6',
    ];
    for (const d of paths) {
      const p = this.doc.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  private setOpen(next: boolean): void {
    this.open = next;
    if (this.sheetEl) this.sheetEl.hidden = !next;
    this.fabButton?.setAttribute('aria-expanded', next ? 'true' : 'false');
    if (next) {
      const state = this.callbacks.readState();
      this.render(state);
      this.positionSheet();
      if (state.pending > 0) this.ensurePoll();
    } else {
      const state = this.callbacks.readState();
      if (state.pending === 0) this.stopPoll();
    }
  }

  private ensurePoll(): void {
    if (this.pollTimer !== 0) return;
    const view = this.doc.defaultView;
    if (!view) return;
    this.pollTimer = view.setInterval(() => {
      const state = this.callbacks.readState();
      this.render(state);
      if (state.pending === 0) this.stopPoll();
    }, 500);
  }

  private stopPoll(): void {
    if (this.pollTimer === 0) return;
    this.doc.defaultView?.clearInterval(this.pollTimer);
    this.pollTimer = 0;
  }

  private applyPosition(): void {
    if (!this.host) return;
    const margin = 10;
    this.host.style.top = `calc(${this.position.y}vh - 22px)`;
    this.host.style.transform = '';
    if (this.position.side === 'left') {
      this.host.style.left = `${margin}px`;
      this.host.style.right = 'auto';
    } else {
      this.host.style.right = `${margin}px`;
      this.host.style.left = 'auto';
    }
    if (this.open) this.positionSheet();
  }

  private positionSheet(): void {
    if (!this.sheetEl) return;
    const view = this.doc.defaultView;
    const vh = view?.innerHeight ?? 800;
    const anchorY = (this.position.y / 100) * vh;
    const placeAbove = anchorY > vh * 0.45;
    if (this.position.side === 'left') {
      this.sheetEl.style.left = '12px';
      this.sheetEl.style.right = 'auto';
    } else {
      this.sheetEl.style.right = '12px';
      this.sheetEl.style.left = 'auto';
    }
    if (placeAbove) {
      this.sheetEl.style.bottom = `${Math.max(12, Math.round(vh - anchorY + 34))}px`;
      this.sheetEl.style.top = 'auto';
    } else {
      this.sheetEl.style.top = `${Math.max(12, Math.round(anchorY + 34))}px`;
      this.sheetEl.style.bottom = 'auto';
    }
  }

  private render(state: FloatingMenuState = this.callbacks.readState()): void {
    if (!this.host || !this.fabButton) return;

    this.fabButton.setAttribute('aria-label', this.labels.brand);
    this.fabButton.setAttribute('data-active', state.active ? '1' : '0');

    if (this.badgeEl) {
      if (state.active && state.pending > 0 && state.total > 0) {
        this.badgeEl.textContent = `${state.done}/${state.total}`;
        this.badgeEl.hidden = false;
      } else {
        this.badgeEl.hidden = true;
      }
    }

    if (this.titleEl) this.titleEl.textContent = this.labels.brand;
    if (this.closeBtn) this.closeBtn.setAttribute('aria-label', this.labels.close);
    if (this.primaryBtn) {
      this.primaryBtn.textContent = state.active
        ? this.labels.restorePage
        : this.labels.translatePage;
    }

    if (this.statusEl) {
      if (state.active && state.pending > 0 && state.total > 0) {
        this.statusEl.textContent = this.labels.pageProgress(state.done, state.total);
        this.statusEl.hidden = false;
      } else if (state.active && state.pending === 0) {
        this.statusEl.textContent = this.labels.pageTranslated;
        this.statusEl.hidden = false;
      } else {
        this.statusEl.hidden = true;
      }
    }

    if (this.displayBtn) {
      this.displayBtn.textContent =
        state.display === 'bilingual' ? this.labels.displayReplace : this.labels.displayBilingual;
    }
    if (this.typedBtn) this.typedBtn.textContent = this.labels.openTyped;
    if (this.targetLabelEl) this.targetLabelEl.textContent = this.labels.targetLabel;
    if (this.targetSelect) {
      if (this.targetSelect.options.length !== TARGET_OPTIONS.length) {
        this.targetSelect.textContent = '';
        for (const lang of TARGET_OPTIONS) {
          const opt = this.doc.createElement('option');
          opt.value = lang;
          opt.textContent = displayTargetLanguage(lang, this.prefs.uiLanguage);
          this.targetSelect.appendChild(opt);
        }
      } else {
        for (let i = 0; i < TARGET_OPTIONS.length; i += 1) {
          const opt = this.targetSelect.options[i];
          const lang = TARGET_OPTIONS[i];
          if (opt && lang) {
            opt.textContent = displayTargetLanguage(lang, this.prefs.uiLanguage);
          }
        }
      }
      this.targetSelect.value = state.targetLanguage;
    }

    if (this.alwaysInput) this.alwaysInput.checked = state.auto === 'always';
    if (this.alwaysTextEl) this.alwaysTextEl.textContent = this.labels.alwaysSite;
    if (this.optionsBtn) this.optionsBtn.textContent = this.labels.openOptions;
    if (this.hideBtn) this.hideBtn.textContent = this.labels.hideTab;

    if (state.pending > 0) this.ensurePoll();
  }

  private readonly onFabClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    this.setOpen(!this.open);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    const view = this.doc.defaultView;
    const vh = view?.innerHeight ?? 800;
    this.dragOffsetY = (this.position.y / 100) * vh - event.clientY;
    this.dragged = false;
    try {
      this.fabButton?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests may not be capturable.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId || !this.host) return;
    const dx = event.clientX - this.dragStartX;
    const dy = event.clientY - this.dragStartY;
    if (!this.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    this.dragged = true;
    if (this.open) this.setOpen(false);
    const view = this.doc.defaultView;
    const vw = view?.innerWidth ?? 390;
    const vh = view?.innerHeight ?? 800;
    const yPct =
      Math.round(Math.min(92, Math.max(8, ((event.clientY + this.dragOffsetY) / vh) * 100)) * 10) /
      10;
    const side: FloatingButtonSide = event.clientX < vw / 2 ? 'left' : 'right';
    this.position = { side, y: yPct };
    this.applyPosition();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    try {
      this.fabButton?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if capture was not set.
    }
    if (this.dragged) {
      this.callbacks.onPositionChange(this.position);
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
  };

  private readonly onDocPointerDown = (event: PointerEvent): void => {
    if (!this.open || !this.host) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(this.host)) return;
    this.setOpen(false);
  };

  private readonly onDocKeyDown = (event: KeyboardEvent): void => {
    if (this.open && event.key === 'Escape') {
      this.setOpen(false);
    }
  };

  private readonly onResize = (): void => {
    this.syncMount();
    this.applyPosition();
  };
}
