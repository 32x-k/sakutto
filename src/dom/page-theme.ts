export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

export interface PageTheme {
  /** Whether the sampled page surface is dark. */
  dark: boolean;
  /** Primary page canvas color (used for floating button & menu sheet). */
  surface: Rgb;
  /** Top header / theme-color surface (used for top progress bar). */
  header: Rgb;
  /** Whether the sampled header itself is dark. */
  headerDark: boolean;
  /** Accent color harmonized with the page and contrast-checked against the bar/FAB. */
  accent: Rgb;
  /** High-contrast foreground color for elements placed on `accent`. */
  accentContrast: Rgb;
}

const LIGHT_FALLBACK_BG: Rgb = { r: 255, g: 255, b: 255 };
const DARK_FALLBACK_BG: Rgb = { r: 21, g: 27, b: 35 };
const LIGHT_FALLBACK_ACCENT: Rgb = { r: 15, g: 118, b: 110 };
const DARK_FALLBACK_ACCENT: Rgb = { r: 45, g: 212, b: 191 };
const DARK_INK: Rgb = { r: 15, g: 23, b: 42 };
const LIGHT_INK: Rgb = { r: 241, g: 245, b: 249 };

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampUnit(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Parses common CSS color outputs (`rgb()`, `rgba()`, `#rgb`, `#rrggbb`, `#rgba`, `#rrggbbaa`). */
export function parseCssColor(raw: string | null | undefined): Rgba | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value || value === 'transparent' || value === 'none' || value === 'auto') return null;

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt(hex[0]! + hex[0]!, 16);
      const g = Number.parseInt(hex[1]! + hex[1]!, 16);
      const b = Number.parseInt(hex[2]! + hex[2]!, 16);
      const a = hex.length === 4 ? Number.parseInt(hex[3]! + hex[3]!, 16) / 255 : 1;
      if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
      if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
      return { r, g, b, a };
    }
    return null;
  }

  const fnMatch = /^rgba?\(([^)]+)\)$/u.exec(value);
  if (!fnMatch?.[1]) return null;
  const body = fnMatch[1].replace(/\s*\/\s*/gu, ' ').replace(/,/gu, ' ');
  const parts = body.trim().split(/\s+/u);
  if (parts.length < 3 || parts.length > 4) return null;

  const parseChannel = (token: string): number => {
    if (token.endsWith('%')) {
      const pct = Number.parseFloat(token.slice(0, -1));
      return Number.isFinite(pct) ? clampByte((pct / 100) * 255) : Number.NaN;
    }
    const num = Number.parseFloat(token);
    return Number.isFinite(num) ? clampByte(num) : Number.NaN;
  };

  const r = parseChannel(parts[0]!);
  const g = parseChannel(parts[1]!);
  const b = parseChannel(parts[2]!);
  let a = 1;
  if (parts[3] !== undefined) {
    const rawAlpha = parts[3];
    const parsed = rawAlpha.endsWith('%')
      ? Number.parseFloat(rawAlpha.slice(0, -1)) / 100
      : Number.parseFloat(rawAlpha);
    if (!Number.isFinite(parsed)) return null;
    a = clampUnit(parsed);
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b, a };
}

/** WCAG 2.1 relative luminance in `[0, 1]`. */
export function relativeLuminance(rgb: Rgb): number {
  const linear = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

/** WCAG contrast ratio in `[1, 21]`. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function isDarkColor(rgb: Rgb): boolean {
  return relativeLuminance(rgb) < 0.28;
}

export function saturationOf(rgb: Rgb): number {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

export function mixRgb(a: Rgb, b: Rgb, ratio: number): Rgb {
  const t = clampUnit(ratio);
  return {
    r: clampByte(a.r + (b.r - a.r) * t),
    g: clampByte(a.g + (b.g - a.g) * t),
    b: clampByte(a.b + (b.b - a.b) * t),
  };
}

export function rgbaCss(rgb: Rgb, alpha: number): string {
  const a = Math.round(clampUnit(alpha) * 1000) / 1000;
  return `rgba(${String(rgb.r)}, ${String(rgb.g)}, ${String(rgb.b)}, ${String(a)})`;
}

export function rgbCss(rgb: Rgb): string {
  return `rgb(${String(rgb.r)}, ${String(rgb.g)}, ${String(rgb.b)})`;
}

/** Adjusts a candidate accent color until it meets minimum contrast against `background`. */
export function ensureAccentContrast(candidate: Rgb, background: Rgb, minContrast = 3.2): Rgb {
  if (contrastRatio(candidate, background) >= minContrast) return candidate;
  const target = isDarkColor(background) ? LIGHT_INK : DARK_INK;
  for (let step = 1; step <= 10; step += 1) {
    const adjusted = mixRgb(candidate, target, step * 0.08);
    if (contrastRatio(adjusted, background) >= minContrast) return adjusted;
  }
  return isDarkColor(background) ? DARK_FALLBACK_ACCENT : LIGHT_FALLBACK_ACCENT;
}

function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  return mixRgb(bg, fg, fg.a);
}

function prefersDarkScheme(doc: Document): boolean {
  try {
    return Boolean(doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  } catch {
    return false;
  }
}

function readMetaThemeColor(doc: Document): Rgb | null {
  const view = doc.defaultView;
  const metas = doc.querySelectorAll('meta[name="theme-color" i]');
  for (const meta of metas) {
    const media = meta.getAttribute('media');
    if (media && view?.matchMedia) {
      try {
        if (!view.matchMedia(media).matches) continue;
      } catch {
        continue;
      }
    }
    const parsed = parseCssColor(meta.getAttribute('content'));
    if (parsed && parsed.a >= 0.6) return { r: parsed.r, g: parsed.g, b: parsed.b };
  }
  return null;
}

function readElementBackground(doc: Document, el: Element | null, fallback: Rgb): Rgb | null {
  if (!el) return null;
  const style = doc.defaultView?.getComputedStyle?.(el);
  if (!style) return null;
  const parsed = parseCssColor(style.backgroundColor);
  if (!parsed || parsed.a < 0.45) return null;
  return parsed.a >= 0.99
    ? { r: parsed.r, g: parsed.g, b: parsed.b }
    : compositeOver(parsed, fallback);
}

function readTopHeaderBackground(doc: Document, surface: Rgb): Rgb | null {
  const candidates = doc.querySelectorAll('header, nav, [role="banner"]');
  let checked = 0;
  for (const el of candidates) {
    if (++checked > 6) break;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.top > 8 || rect.height < 24 || rect.height > 140 || rect.width < 200) {
      continue;
    }
    const bg = readElementBackground(doc, el, surface);
    if (bg) return bg;
  }
  return null;
}

function readPageAccent(doc: Document, background: Rgb): Rgb | null {
  const view = doc.defaultView;
  if (!view?.getComputedStyle) return null;

  for (const el of [doc.documentElement, doc.body]) {
    if (!el) continue;
    const style = view.getComputedStyle(el);
    const accent = parseCssColor(style.accentColor);
    if (accent && accent.a >= 0.6 && saturationOf(accent) >= 0.25) {
      return ensureAccentContrast(accent, background);
    }
  }

  const root = doc.querySelector('main, article, [role="main"]') ?? doc.body;
  if (!root) return null;
  const links = root.querySelectorAll('a[href]');
  let checked = 0;
  for (const link of links) {
    if (++checked > 12) break;
    const style = view.getComputedStyle(link);
    const color = parseCssColor(style.color);
    if (!color || color.a < 0.6) continue;
    if (saturationOf(color) < 0.25) continue;
    if (contrastRatio(color, background) < 1.6) continue;
    return ensureAccentContrast(color, background);
  }
  return null;
}

/**
 * Samples the host page's real canvas color, header/theme-color, and link/accent color
 * in O(1) bounded DOM lookups so overlays blend naturally with any light, dark, sepia,
 * or brand-colored website.
 */
export function samplePageTheme(doc: Document): PageTheme {
  const osDark = prefersDarkScheme(doc);
  const fallbackBg = osDark ? DARK_FALLBACK_BG : LIGHT_FALLBACK_BG;

  const htmlBg = readElementBackground(doc, doc.documentElement, fallbackBg);
  const bodyBg = readElementBackground(doc, doc.body, htmlBg ?? fallbackBg);
  const surface = bodyBg ?? htmlBg ?? fallbackBg;
  const dark = isDarkColor(surface);

  const metaBg = readMetaThemeColor(doc);
  const headerBg = metaBg ?? readTopHeaderBackground(doc, surface) ?? surface;
  const headerDark = isDarkColor(headerBg);

  const fallbackAccent = headerDark ? DARK_FALLBACK_ACCENT : LIGHT_FALLBACK_ACCENT;
  const accent = readPageAccent(doc, headerBg) ?? ensureAccentContrast(fallbackAccent, headerBg);
  const accentContrast =
    contrastRatio(LIGHT_INK, accent) >= contrastRatio(DARK_INK, accent) ? LIGHT_INK : DARK_INK;

  return {
    dark,
    surface,
    header: headerBg,
    headerDark,
    accent,
    accentContrast,
  };
}

/** Applies dynamic page-adaptive CSS custom properties onto the top progress bar host. */
export function applyBarTheme(host: HTMLElement, theme: PageTheme): void {
  const ink = theme.headerDark ? LIGHT_INK : DARK_INK;
  const elevated = mixRgb(theme.header, ink, theme.headerDark ? 0.08 : 0.04);
  const barAccent = ensureAccentContrast(theme.accent, theme.header, 3.2);
  const warning = theme.headerDark ? { r: 251, g: 191, b: 36 } : { r: 180, g: 83, b: 9 };

  host.style.setProperty('--bar-bg', rgbaCss(elevated, theme.headerDark ? 0.82 : 0.84));
  host.style.setProperty('--bar-text', rgbCss(ink));
  host.style.setProperty('--bar-muted', rgbaCss(ink, 0.72));
  host.style.setProperty('--bar-border', rgbaCss(ink, theme.headerDark ? 0.14 : 0.1));
  host.style.setProperty(
    '--bar-shadow',
    theme.headerDark ? '0 4px 16px rgba(0, 0, 0, 0.28)' : '0 4px 14px rgba(15, 23, 42, 0.08)',
  );
  host.style.setProperty('--bar-btn-bg', rgbaCss(ink, theme.headerDark ? 0.09 : 0.06));
  host.style.setProperty('--bar-btn-hover', rgbaCss(ink, theme.headerDark ? 0.16 : 0.11));
  host.style.setProperty('--bar-btn-border', rgbaCss(ink, theme.headerDark ? 0.16 : 0.12));
  host.style.setProperty('--bar-accent', rgbCss(barAccent));
  host.style.setProperty('--bar-track', rgbaCss(barAccent, theme.headerDark ? 0.2 : 0.16));
  host.style.setProperty('--bar-warning', rgbCss(warning));
}

/**
 * Applies dynamic page-adaptive CSS custom properties onto the floating quick-menu host,
 * using soft frosted translucency at rest so the button blends gracefully into the page.
 */
export function applyFabTheme(host: HTMLElement, theme: PageTheme): void {
  const ink = theme.dark ? LIGHT_INK : DARK_INK;
  const fabAccent = ensureAccentContrast(theme.accent, theme.surface, 3.0);
  const fabAccentStrong = ensureAccentContrast(theme.accent, theme.surface, 4.5);
  const fabContrast =
    contrastRatio(LIGHT_INK, fabAccent) >= contrastRatio(DARK_INK, fabAccent)
      ? LIGHT_INK
      : DARK_INK;
  const surfacePill = mixRgb(theme.surface, ink, theme.dark ? 0.08 : 0.03);
  const sheetSurface = mixRgb(theme.surface, ink, theme.dark ? 0.06 : 0.02);
  const controlSurface = mixRgb(theme.surface, ink, theme.dark ? 0.12 : 0.06);

  host.style.setProperty('--bg', rgbaCss(sheetSurface, theme.dark ? 0.91 : 0.93));
  host.style.setProperty('--fab-bg', rgbaCss(surfacePill, theme.dark ? 0.56 : 0.6));
  host.style.setProperty('--fab-bg-hover', rgbaCss(surfacePill, theme.dark ? 0.88 : 0.92));
  host.style.setProperty('--surface', rgbaCss(controlSurface, theme.dark ? 0.86 : 0.9));
  host.style.setProperty('--text', rgbCss(ink));
  host.style.setProperty('--muted', rgbaCss(ink, 0.68));
  host.style.setProperty('--border', rgbaCss(ink, theme.dark ? 0.16 : 0.13));
  host.style.setProperty('--accent', rgbCss(fabAccent));
  host.style.setProperty('--fab-accent-bg', rgbaCss(fabAccent, theme.dark ? 0.72 : 0.76));
  host.style.setProperty('--fab-accent-bg-hover', rgbaCss(fabAccent, 0.94));
  host.style.setProperty('--accent-strong', rgbCss(fabAccentStrong));
  host.style.setProperty('--accent-contrast', rgbCss(fabContrast));
  host.style.setProperty(
    '--fab-shadow',
    theme.dark ? '0 4px 14px rgba(0, 0, 0, 0.30)' : '0 4px 14px rgba(15, 23, 42, 0.11)',
  );
  host.style.setProperty(
    '--shadow',
    theme.dark ? '0 10px 28px rgba(0, 0, 0, 0.44)' : '0 10px 26px rgba(15, 23, 42, 0.18)',
  );
}
