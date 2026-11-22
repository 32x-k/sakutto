import { FASTFLOWLM_PLAMO_MODELS } from '@/engine/local-server/url';
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
import { applyFabTheme, samplePageTheme } from './page-theme';
import type { SiteAuto } from './sites';

export const FLOATING_MENU_TAG = 'sakutto-fab';
const DEFAULT_POSITION: FloatingButtonPosition = { side: 'right', y: 74 };
const DRAG_THRESHOLD_PX = 8;
const SWIPE_HIDE_THRESHOLD_PX = 44;

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
  retranslatePage?: string;
  displayReplace: string;
  displayBilingual: string;
  targetLabel: string;
  modelLabel?: string;
  alwaysSite: string;
  openTyped: string;
  openOptions: string;
  hideTab: string;
  close: string;
  pageTranslated: string;
  pageProgress: (done: number, total: number) => string;
  pageCached?: (cached: number, done: number) => string;
  serverError?: string;
}

export interface FloatingMenuProbeStatus {
  active: boolean;
  ok?: boolean;
  text: string;
  detail?: string;
}

export interface FloatingMenuState {
  active: boolean;
  display: DisplayMode;
  pending: number;
  done: number;
  total: number;
  auto: SiteAuto;
  targetLanguage: TargetLanguage;
  serverFault?: boolean;
  cached?: number;
  localServerModel?: string;
  availableModels?: readonly string[] | null;
  probeStatus?: FloatingMenuProbeStatus | null;
}

export interface FloatingMenuPreferences {
  mode: FloatingButtonMode;
  position: FloatingButtonPosition | null;
  uiLanguage: string;
}

export interface FloatingMenuCallbacks {
  onTogglePage: () => void;
  onRetranslate?: () => void;
  onSelectModel?: (modelId: string) => void;
  onOpenSheet?: () => void;
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
  --bg: rgba(255, 255, 255, 0.92);
  --fab-bg: rgba(255, 255, 255, 0.60);
  --fab-bg-hover: rgba(255, 255, 255, 0.92);
  --surface: rgba(244, 247, 248, 0.90);
  --text: #0f172a;
  --muted: rgba(15, 23, 42, 0.68);
  --border: rgba(15, 23, 42, 0.13);
  --accent: #0f766e;
  --fab-accent-bg: rgba(15, 118, 110, 0.76);
  --fab-accent-bg-hover: rgba(15, 118, 110, 0.94);
  --accent-strong: #115e59;
  --accent-contrast: #ffffff;
  --fab-shadow: 0 4px 14px rgba(15, 23, 42, 0.11);
  --shadow: 0 10px 26px rgba(15, 23, 42, 0.18);
}
* { box-sizing: border-box; }
.fab-btn {
  position: relative;
  overflow: visible;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 44px;
  height: 44px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--fab-bg);
  color: var(--accent);
  box-shadow: var(--fab-shadow);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  opacity: 0.74;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-size: 12px;
  font-weight: 700;
  transition: transform 0.14s ease, opacity 0.18s ease, background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}
.fab-btn[data-progressing="1"]::before {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  padding: 2.5px;
  background: conic-gradient(
    var(--accent) var(--fab-progress, 0%),
    rgba(127, 127, 127, 0.22) 0
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  pointer-events: none;
}
.fab-btn[data-active="1"][data-progressing="1"]::before {
  background: conic-gradient(
    var(--accent-contrast) var(--fab-progress, 0%),
    rgba(255, 255, 255, 0.24) 0
  );
}
.status-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 9px;
  height: 9px;
  border-radius: 999px;
  border: 1.5px solid var(--bg);
  background: var(--accent);
  pointer-events: none;
}
.status-dot[data-kind="fault"] {
  background: #f59e0b;
}
.status-dot[hidden] {
  display: none;
}
.fab-btn:hover,
.fab-btn:focus-visible,
.fab-btn[aria-expanded="true"],
.fab-btn[data-dragging="1"] {
  opacity: 1;
  background: var(--fab-bg-hover);
  box-shadow: var(--shadow);
}
.fab-btn:active {
  transform: scale(0.95);
}
.fab-btn[data-active="1"] {
  background: var(--fab-accent-bg);
  color: var(--accent-contrast);
  border-color: transparent;
  opacity: 0.84;
}
.fab-btn[data-active="1"]:hover,
.fab-btn[data-active="1"]:focus-visible,
.fab-btn[data-active="1"][aria-expanded="true"],
.fab-btn[data-active="1"][data-dragging="1"] {
  background: var(--fab-accent-bg-hover);
  opacity: 1;
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
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
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
.fault-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: var(--text);
  font-size: 12px;
  line-height: 1.35;
}
.fault-banner[hidden] {
  display: none;
}
.fault-banner button {
  flex-shrink: 0;
  border: none;
  border-radius: 7px;
  padding: 4px 8px;
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
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
.btn.full {
  width: 100%;
}
.model-box {
  display: grid;
  gap: 6px;
}
.model-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}
.model-current {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--text);
}
.model-pills {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.model-pill {
  min-height: 32px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  text-align: center;
}
.model-pill[aria-pressed="true"] {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: transparent;
}
.probe-status {
  display: grid;
  gap: 3px;
  padding: 7px 9px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 11px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}
.probe-status[hidden] {
  display: none;
}
.probe-status[data-state="ok"] {
  border-color: rgba(15, 118, 110, 0.35);
}
.probe-status[data-state="error"] {
  border-color: rgba(239, 68, 68, 0.45);
  color: #dc2626;
}
.probe-main {
  font-weight: 600;
}
.probe-detail {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
}
.probe-detail[hidden] {
  display: none;
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
  private statusDotEl: HTMLSpanElement | null = null;
  private sheetEl: HTMLDivElement | null = null;
  private titleEl: HTMLSpanElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private primaryBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLParagraphElement | null = null;
  private faultBannerEl: HTMLDivElement | null = null;
  private faultTextEl: HTMLSpanElement | null = null;
  private faultOptionsBtn: HTMLButtonElement | null = null;
  private retranslateBtn: HTMLButtonElement | null = null;
  private modelLabelEl: HTMLSpanElement | null = null;
  private modelCurrentEl: HTMLSpanElement | null = null;
  private modelPillBtns: Map<string, HTMLButtonElement> = new Map();
  private probeStatusEl: HTMLDivElement | null = null;
  private probeMainEl: HTMLSpanElement | null = null;
  private probeDetailEl: HTMLSpanElement | null = null;
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
  private dragStartSide: FloatingButtonSide = 'right';
  private dragged = false;
  private swipeDismissed = false;

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
    this.applyTheme();
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

    const statusDot = this.doc.createElement('span');
    statusDot.className = 'status-dot';
    statusDot.setAttribute('data-sakutto-fab', 'status-dot');
    statusDot.setAttribute('aria-hidden', 'true');
    statusDot.hidden = true;
    fab.appendChild(statusDot);

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

    const faultBanner = this.doc.createElement('div');
    faultBanner.className = 'fault-banner';
    faultBanner.setAttribute('role', 'alert');
    faultBanner.setAttribute('data-sakutto-fab', 'fault-banner');
    faultBanner.hidden = true;
    const faultText = this.doc.createElement('span');
    const faultOptionsBtn = this.doc.createElement('button');
    faultOptionsBtn.type = 'button';
    faultOptionsBtn.setAttribute('data-sakutto-fab', 'fault-options');
    faultOptionsBtn.addEventListener('click', () => {
      this.setOpen(false);
      this.callbacks.onOpenOptions();
    });
    faultBanner.append(faultText, faultOptionsBtn);

    const retranslateBtn = this.doc.createElement('button');
    retranslateBtn.type = 'button';
    retranslateBtn.className = 'btn full';
    retranslateBtn.setAttribute('data-sakutto-fab', 'retranslate');
    retranslateBtn.addEventListener('click', () => {
      this.callbacks.onRetranslate?.();
      this.ensurePoll();
      this.render();
    });

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

    const modelBox = this.doc.createElement('div');
    modelBox.className = 'model-box';
    modelBox.setAttribute('data-sakutto-fab', 'model-section');
    const modelHeader = this.doc.createElement('div');
    modelHeader.className = 'model-header';
    const modelLabel = this.doc.createElement('span');
    const modelCurrent = this.doc.createElement('span');
    modelCurrent.className = 'model-current';
    modelHeader.append(modelLabel, modelCurrent);

    const modelPills = this.doc.createElement('div');
    modelPills.className = 'model-pills';
    modelPills.setAttribute('data-sakutto-fab', 'model-pills');
    this.modelPillBtns.clear();
    for (const modelId of FASTFLOWLM_PLAMO_MODELS) {
      const pill = this.doc.createElement('button');
      pill.type = 'button';
      pill.className = 'model-pill';
      pill.setAttribute('data-sakutto-fab-model', modelId);
      const shortTag = modelId.split(':')[1]?.toUpperCase() ?? modelId;
      pill.textContent = shortTag;
      pill.addEventListener('click', () => {
        this.callbacks.onSelectModel?.(modelId);
        this.ensurePoll();
        this.render();
      });
      this.modelPillBtns.set(modelId, pill);
      modelPills.appendChild(pill);
    }

    const probeStatus = this.doc.createElement('div');
    probeStatus.className = 'probe-status';
    probeStatus.setAttribute('role', 'status');
    probeStatus.setAttribute('data-sakutto-fab', 'model-probe-status');
    probeStatus.hidden = true;
    const probeMain = this.doc.createElement('span');
    probeMain.className = 'probe-main';
    const probeDetail = this.doc.createElement('span');
    probeDetail.className = 'probe-detail';
    probeDetail.hidden = true;
    probeStatus.append(probeMain, probeDetail);

    modelBox.append(modelHeader, modelPills, probeStatus);

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

    sheet.append(
      header,
      primaryBtn,
      statusEl,
      faultBanner,
      retranslateBtn,
      row,
      modelBox,
      targetField,
      alwaysLabel,
      footer,
    );
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
    this.statusDotEl = statusDot;
    this.sheetEl = sheet;
    this.titleEl = title;
    this.closeBtn = closeBtn;
    this.primaryBtn = primaryBtn;
    this.statusEl = statusEl;
    this.faultBannerEl = faultBanner;
    this.faultTextEl = faultText;
    this.faultOptionsBtn = faultOptionsBtn;
    this.retranslateBtn = retranslateBtn;
    this.modelLabelEl = modelLabel;
    this.modelCurrentEl = modelCurrent;
    this.probeStatusEl = probeStatus;
    this.probeMainEl = probeMain;
    this.probeDetailEl = probeDetail;
    this.displayBtn = displayBtn;
    this.typedBtn = typedBtn;
    this.targetLabelEl = targetLabel;
    this.targetSelect = targetSelect;
    this.alwaysInput = alwaysInput;
    this.alwaysTextEl = alwaysText;
    this.optionsBtn = optionsBtn;
    this.hideBtn = hideBtn;

    this.applyTheme();
    this.applyPosition();
    this.render();
  }

  private applyTheme(): void {
    if (!this.host) return;
    applyFabTheme(this.host, samplePageTheme(this.doc));
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
    this.statusDotEl = null;
    this.sheetEl = null;
    this.titleEl = null;
    this.closeBtn = null;
    this.primaryBtn = null;
    this.statusEl = null;
    this.faultBannerEl = null;
    this.faultTextEl = null;
    this.faultOptionsBtn = null;
    this.retranslateBtn = null;
    this.modelLabelEl = null;
    this.modelCurrentEl = null;
    this.modelPillBtns.clear();
    this.probeStatusEl = null;
    this.probeMainEl = null;
    this.probeDetailEl = null;
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
      this.callbacks.onOpenSheet?.();
      this.applyTheme();
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

    const progressing = state.active && state.pending > 0 && state.total > 0;
    const fault = state.serverFault === true;

    this.fabButton.setAttribute('aria-label', this.labels.brand);
    this.fabButton.setAttribute('data-active', state.active ? '1' : '0');
    this.fabButton.setAttribute('data-progressing', progressing ? '1' : '0');
    if (progressing) {
      const pct = Math.max(4, Math.min(100, Math.round((state.done / state.total) * 100)));
      this.fabButton.style.setProperty('--fab-progress', `${pct}%`);
    } else {
      this.fabButton.style.removeProperty('--fab-progress');
    }

    if (this.badgeEl) {
      if (progressing) {
        this.badgeEl.textContent = `${state.done}/${state.total}`;
        this.badgeEl.hidden = false;
      } else {
        this.badgeEl.hidden = true;
      }
    }

    if (this.statusDotEl) {
      if (fault) {
        this.statusDotEl.setAttribute('data-kind', 'fault');
        this.statusDotEl.hidden = false;
      } else if (state.auto === 'always') {
        this.statusDotEl.setAttribute('data-kind', 'auto');
        this.statusDotEl.hidden = false;
      } else {
        this.statusDotEl.removeAttribute('data-kind');
        this.statusDotEl.hidden = true;
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
      const cachedCount = state.cached ?? 0;
      const doneCount = Math.floor(state.done);
      const cacheSuffix =
        cachedCount > 0 && doneCount > 0 && this.labels.pageCached
          ? ` (${this.labels.pageCached(cachedCount, doneCount)})`
          : '';
      if (progressing) {
        this.statusEl.textContent = `${this.labels.pageProgress(state.done, state.total)}${cacheSuffix}`;
        this.statusEl.hidden = false;
      } else if (state.active && state.pending === 0 && !fault) {
        this.statusEl.textContent = `${this.labels.pageTranslated}${cacheSuffix}`;
        this.statusEl.hidden = false;
      } else {
        this.statusEl.hidden = true;
      }
    }

    if (this.faultBannerEl && this.faultTextEl && this.faultOptionsBtn) {
      if (fault && this.labels.serverError) {
        this.faultTextEl.textContent = this.labels.serverError;
        this.faultOptionsBtn.textContent = this.labels.openOptions;
        this.faultBannerEl.hidden = false;
      } else {
        this.faultBannerEl.hidden = true;
      }
    }

    if (this.retranslateBtn) {
      const ja = this.prefs.uiLanguage.toLowerCase().startsWith('ja');
      this.retranslateBtn.textContent =
        this.labels.retranslatePage ??
        (ja ? '再翻訳（キャッシュ更新）' : 'Retranslate (refresh cache)');
      this.retranslateBtn.hidden = !state.active;
    }

    if (this.modelLabelEl) {
      const ja = this.prefs.uiLanguage.toLowerCase().startsWith('ja');
      this.modelLabelEl.textContent = this.labels.modelLabel ?? (ja ? 'モデル' : 'Model');
    }
    if (this.modelCurrentEl) {
      this.modelCurrentEl.textContent = state.localServerModel || 'plamo3-translate:2b';
    }
    const availableSet =
      Array.isArray(state.availableModels) && state.availableModels.length > 0
        ? new Set(state.availableModels)
        : null;
    const isJa = this.prefs.uiLanguage.toLowerCase().startsWith('ja');
    for (const [modelId, pill] of this.modelPillBtns.entries()) {
      const unavailable = availableSet !== null && !availableSet.has(modelId);
      pill.disabled = unavailable;
      pill.style.opacity = unavailable ? '0.38' : '';
      pill.style.cursor = unavailable ? 'not-allowed' : '';
      pill.title = unavailable ? (isJa ? 'サーバー側で無効' : 'Disabled on server') : '';
      pill.setAttribute(
        'aria-pressed',
        !unavailable && (state.localServerModel || 'plamo3-translate:2b') === modelId
          ? 'true'
          : 'false',
      );
    }

    if (this.probeStatusEl && this.probeMainEl && this.probeDetailEl) {
      const probe = state.probeStatus;
      if (probe && probe.text.length > 0) {
        this.probeMainEl.textContent = probe.text;
        if (probe.detail && probe.detail.length > 0) {
          this.probeDetailEl.textContent = probe.detail;
          this.probeDetailEl.hidden = false;
        } else {
          this.probeDetailEl.hidden = true;
        }
        this.probeStatusEl.setAttribute(
          'data-state',
          probe.active ? 'running' : probe.ok === false ? 'error' : 'ok',
        );
        this.probeStatusEl.hidden = false;
      } else {
        this.probeStatusEl.hidden = true;
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
    this.dragStartSide = this.position.side;
    this.dragged = false;
    this.swipeDismissed = false;
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
    this.fabButton?.setAttribute('data-dragging', '1');
    if (this.open) this.setOpen(false);

    const outwardDx = this.dragStartSide === 'right' ? dx : -dx;
    if (outwardDx >= 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const shift = Math.min(56, outwardDx);
      this.host.style.transform = `translateX(${Math.round(
        this.dragStartSide === 'right' ? shift : -shift,
      )}px)`;
      if (this.fabButton) {
        this.fabButton.style.opacity = String(Math.max(0.2, 1 - outwardDx / 68));
      }
      this.swipeDismissed = outwardDx >= SWIPE_HIDE_THRESHOLD_PX;
      return;
    }

    this.swipeDismissed = false;
    this.host.style.transform = '';
    if (this.fabButton) this.fabButton.style.opacity = '';
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
    this.fabButton?.removeAttribute('data-dragging');
    if (this.fabButton) this.fabButton.style.opacity = '';
    try {
      this.fabButton?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore if capture was not set.
    }
    if (this.swipeDismissed) {
      this.swipeDismissed = false;
      this.dragged = false;
      this.hiddenForTab = true;
      this.setOpen(false);
      this.unmount();
      return;
    }
    if (this.host) this.host.style.transform = '';
    if (this.dragged) {
      this.callbacks.onPositionChange(this.position);
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;
    this.swipeDismissed = false;
    this.fabButton?.removeAttribute('data-dragging');
    if (this.fabButton) this.fabButton.style.opacity = '';
    if (this.host) this.host.style.transform = '';
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
