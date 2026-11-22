import type { CaptionOverlayLabels } from '@/captions/overlay';
import { VideoCaptionSession, type CaptionSessionPreferences } from '@/captions/session';
import { captionsAllowedOnPage, videoCaptionPositionSite } from '@/captions/sites';
import { fakeTranslate } from '@/dom/fake-engine';
import { loadSiteRule, pageHost, subscribeSiteRules, type SiteRule } from '@/dom/sites';
import { contentExtensionId, installContentInvalidationCleanup } from '@/shared/content-instance';
import { mergeGlossary } from '@/shared/glossary';
import { t } from '@/shared/i18n';
import { effectivePageTarget } from '@/shared/languages';
import { requestEngineStatus } from '@/shared/messages';
import type { Settings, VideoCaptionPosition } from '@/shared/settings';
import { loadSettings, saveSettings, subscribeSettings } from '@/shared/storage';
import { translateViaBackground } from '@/shared/translation-client';

interface CaptionsFeatureGlobal {
  __sakuttoCaptionsFeatureReady?: boolean;
}

const featureGlobal = globalThis as typeof globalThis & CaptionsFeatureGlobal;

function captionLabels(): CaptionOverlayLabels {
  return {
    label: t('videoCaptionsLabel'),
    pending: t('videoCaptionsPending'),
    showOriginal: t('videoCaptionsShowOriginal'),
    hideOriginal: t('videoCaptionsHideOriginal'),
  };
}

function captionPreferencesFor(
  settings: Settings,
  rule: SiteRule,
  host: string,
): CaptionSessionPreferences {
  const glossary = mergeGlossary(settings.glossary, rule.glossary);
  const site = videoCaptionPositionSite(host);
  return {
    enabled:
      settings.translateVideoCaptions &&
      rule.auto !== 'never' &&
      captionsAllowedOnPage(host, settings.captionCustomHosts, document),
    targetLanguage: effectivePageTarget(settings.targetLanguage, rule.targetLanguage),
    form: settings.form,
    display: settings.videoCaptionDisplay,
    size: settings.videoCaptionSize,
    originalToggle: settings.videoCaptionOriginalToggle,
    position: settings.videoCaptionPositions[site] ?? null,
    glossary: glossary.length > 0 ? glossary : undefined,
    customHosts: settings.captionCustomHosts,
    tier: null,
  };
}

/**
 * Standalone runtime bundle for video caption translation (YouTube / X / HTML5).
 * Loaded on demand only on tabs where video captions are enabled, keeping ~165 KB of
 * subtitle parsers and overlay code out of every ordinary web tab.
 */
export function installVideoCaptions(): void {
  if (featureGlobal.__sakuttoCaptionsFeatureReady) return;
  const host = pageHost(location.href);
  if (!host) return;
  if (contentExtensionId().length === 0) return;
  featureGlobal.__sakuttoCaptionsFeatureReady = true;

  let captions: VideoCaptionSession | null = null;
  let engineSource: Settings['engineSource'] = 'in-browser';
  let liveSettings: Settings | null = null;
  let liveRule: SiteRule | null = null;
  let captionDisplayWrite = 0;
  let captionPositionWrite = 0;
  let tornDown = false;

  const engine = {
    async *translate(
      segments: Parameters<typeof translateViaBackground>[0],
      options: Parameters<typeof translateViaBackground>[1],
    ) {
      if (__SAKUTTO_FAKE_ENGINE__ && engineSource !== 'local-server') {
        yield* fakeTranslate(segments, options);
        return;
      }
      yield* translateViaBackground(segments, options);
    },
  };

  installContentInvalidationCleanup(() => {
    if (tornDown) return;
    tornDown = true;
    captions?.stop();
    captions = null;
  });

  const persistCaptionPosition = (point: VideoCaptionPosition): void => {
    if (!liveSettings || !liveRule) return;
    captionPositionWrite += 1;
    const site = videoCaptionPositionSite(host);
    liveSettings = {
      ...liveSettings,
      videoCaptionPositions: { ...liveSettings.videoCaptionPositions, [site]: point },
    };
    captions?.setPreferences(captionPreferencesFor(liveSettings, liveRule, host));
    void saveSettings({ videoCaptionPositions: liveSettings.videoCaptionPositions });
  };

  const sync = (settings: Settings, rule: SiteRule): void => {
    if (tornDown) return;
    engineSource = settings.engineSource;
    const prefs = captionPreferencesFor(settings, rule, host);
    if (!prefs.enabled) {
      captions?.stop();
      captions = null;
      return;
    }
    if (!captions) {
      captions = new VideoCaptionSession(document, {
        engine,
        labels: captionLabels(),
        preferences: prefs,
        onDisplayToggle: () => {
          if (!liveSettings || !liveRule) return;
          captionDisplayWrite += 1;
          const nextDisplay =
            liveSettings.videoCaptionDisplay === 'bilingual' ? 'replace' : 'bilingual';
          liveSettings = { ...liveSettings, videoCaptionDisplay: nextDisplay };
          captions?.setPreferences(captionPreferencesFor(liveSettings, liveRule, host));
          void saveSettings({ videoCaptionDisplay: nextDisplay });
        },
        onPositionChange: persistCaptionPosition,
      });
      captions.start();
      if (!__SAKUTTO_FAKE_ENGINE__ && settings.engineSource !== 'local-server') {
        void requestEngineStatus()
          .then((status) => {
            if (status?.tier) captions?.setTier(status.tier);
          })
          .catch(() => undefined);
      }
      return;
    }
    captions.setLabels(captionLabels());
    captions.setPreferences(prefs);
  };

  const refresh = async (): Promise<void> => {
    const displayId = captionDisplayWrite;
    const positionId = captionPositionWrite;
    const [nextSettings, nextRule] = await Promise.all([loadSettings(), loadSiteRule(host)]);
    liveSettings = {
      ...nextSettings,
      videoCaptionDisplay:
        displayId === captionDisplayWrite || !liveSettings
          ? nextSettings.videoCaptionDisplay
          : liveSettings.videoCaptionDisplay,
      videoCaptionPositions:
        positionId === captionPositionWrite || !liveSettings
          ? nextSettings.videoCaptionPositions
          : liveSettings.videoCaptionPositions,
    };
    liveRule = nextRule;
    sync(liveSettings, liveRule);
  };

  void refresh();
  subscribeSettings(() => {
    void refresh();
  });
  subscribeSiteRules(() => {
    void refresh();
  });
}
