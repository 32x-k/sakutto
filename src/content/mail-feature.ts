import { fakeTranslate } from '@/dom/fake-engine';
import { GmailBannerController, isGmailHost, type GmailBannerLabels } from '@/dom/gmail-banner';
import {
  OutlookBannerController,
  isOutlookHost,
  type OutlookBannerLabels,
} from '@/dom/outlook-banner';
import { loadSiteRule, pageHost, subscribeSiteRules, type SiteRule } from '@/dom/sites';
import {
  CONTENT_INSTANCE_DOC_ATTR,
  claimContentExtensionInstance,
  contentExtensionId,
  contentScriptInstanceToken,
  installContentInvalidationCleanup,
  purgeForeignMailBannerHosts,
  registerLiveContentInstanceToken,
  removeOwnedMailBannerHosts,
  unregisterLiveContentInstanceToken,
} from '@/shared/content-instance';
import { installContentPortLifecycle } from '@/shared/content-port-lifecycle';
import { mergeGlossary } from '@/shared/glossary';
import { currentUiLanguage, t } from '@/shared/i18n';
import { displayLanguage, effectivePageTarget } from '@/shared/languages';
import { requestEngineWarm } from '@/shared/messages';
import type { Settings } from '@/shared/settings';
import { loadSettings, saveSettings, subscribeSettings } from '@/shared/storage';
import { translateViaBackground } from '@/shared/translation-client';
import { displayTargetLanguage } from '@/ui/language-label';

interface MailFeatureGlobal {
  __sakuttoMailFeatureReady?: boolean;
}

const featureGlobal = globalThis as typeof globalThis & MailFeatureGlobal;

function mailBannerLabels(): GmailBannerLabels | OutlookBannerLabels {
  const uiLanguage = currentUiLanguage();
  const sourceName = (language: string) => displayLanguage(language, uiLanguage);
  return {
    region: t('gmailBannerRegion'),
    detected: (language) => t('gmailBannerDetected', [sourceName(language)]),
    translate: (language) =>
      t('gmailBannerTranslate', [displayTargetLanguage(language, uiLanguage)]),
    showOriginal: t('gmailBannerShowOriginal'),
    showTranslation: t('gmailBannerShowTranslation'),
    translating: t('gmailBannerTranslating'),
    error: t('gmailBannerFailed'),
    close: t('close'),
    translated: (source, target) =>
      t('gmailBannerTranslated', [sourceName(source), displayTargetLanguage(target, uiLanguage)]),
    menu: t('gmailBannerMenu'),
    translateNow: (language) => t('gmailBannerTranslateNow', [sourceName(language)]),
    alwaysTranslate: (language) => t('gmailBannerAlwaysTranslate', [sourceName(language)]),
    neverTranslate: (language) => t('gmailBannerNeverTranslate', [sourceName(language)]),
  };
}

function mailBannerPreferencesFor(
  settings: Settings,
  rule: SiteRule,
  host: string,
  provider: 'gmail' | 'outlook',
) {
  const glossary = mergeGlossary(settings.glossary, rule.glossary);
  const onHost = provider === 'gmail' ? isGmailHost(host) : isOutlookHost(host);
  return {
    enabled: settings.gmailTranslateBanner && onHost && rule.auto !== 'always',
    targetLanguage: effectivePageTarget(settings.targetLanguage, rule.targetLanguage),
    form: settings.form,
    autoLanguages: settings.gmailAutoTranslateLangs,
    neverLanguages: settings.gmailNeverTranslateLangs,
    ...(glossary.length > 0 ? { glossary } : {}),
  };
}

/**
 * Standalone runtime bundle for Gmail and Outlook message banners. Loaded only on granted
 * mail hosts (or on demand from `content.js`), keeping ~90 KB of mail DOM logic and
 * stopword dictionaries out of every ordinary web tab.
 */
export function installMailBanners(): void {
  if (featureGlobal.__sakuttoMailFeatureReady) return;
  const host = pageHost(location.href);
  if (!host || (!isGmailHost(host) && !isOutlookHost(host))) return;
  if (contentExtensionId().length === 0) return;
  featureGlobal.__sakuttoMailFeatureReady = true;

  const instanceToken = contentScriptInstanceToken();
  registerLiveContentInstanceToken(instanceToken);
  purgeForeignMailBannerHosts(document, instanceToken);
  claimContentExtensionInstance(document, instanceToken);

  let gmailBanner: GmailBannerController | null = null;
  let outlookBanner: OutlookBannerController | null = null;
  let engineSource: Settings['engineSource'] = 'in-browser';
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

  const teardown = (): void => {
    if (tornDown) return;
    tornDown = true;
    gmailBanner?.dispose();
    outlookBanner?.dispose();
    gmailBanner = null;
    outlookBanner = null;
    unregisterLiveContentInstanceToken(instanceToken);
    removeOwnedMailBannerHosts(document, instanceToken);
    document.documentElement.removeAttribute(CONTENT_INSTANCE_DOC_ATTR);
  };
  installContentPortLifecycle();
  installContentInvalidationCleanup(teardown);

  let mailLanguagesWrite = 0;
  let liveSettings: Settings | null = null;

  const onMailLanguagesChange = (languages: { auto: string[]; never: string[] }): void => {
    mailLanguagesWrite += 1;
    if (liveSettings) {
      liveSettings = {
        ...liveSettings,
        gmailAutoTranslateLangs: languages.auto,
        gmailNeverTranslateLangs: languages.never,
      };
    }
    void saveSettings({
      gmailAutoTranslateLangs: languages.auto,
      gmailNeverTranslateLangs: languages.never,
    });
  };

  const sync = (settings: Settings, rule: SiteRule): void => {
    if (tornDown) return;
    engineSource = settings.engineSource;
    const gmailPrefs = mailBannerPreferencesFor(settings, rule, host, 'gmail');
    if (gmailPrefs.enabled) {
      if (!gmailBanner) {
        gmailBanner = new GmailBannerController(document, {
          engine,
          labels: mailBannerLabels(),
          preferences: gmailPrefs,
          onWarm: () => {
            if (!__SAKUTTO_FAKE_ENGINE__ && engineSource !== 'local-server') {
              void requestEngineWarm();
            }
          },
          onLanguagesChange: onMailLanguagesChange,
        });
        gmailBanner.start();
      } else {
        gmailBanner.setLabels(mailBannerLabels());
        gmailBanner.setPreferences(gmailPrefs);
      }
    } else if (gmailBanner) {
      gmailBanner.dispose();
      gmailBanner = null;
    }

    const outlookPrefs = mailBannerPreferencesFor(settings, rule, host, 'outlook');
    if (outlookPrefs.enabled) {
      if (!outlookBanner) {
        outlookBanner = new OutlookBannerController(document, {
          engine,
          labels: mailBannerLabels(),
          preferences: outlookPrefs,
          onWarm: () => {
            if (!__SAKUTTO_FAKE_ENGINE__ && engineSource !== 'local-server') {
              void requestEngineWarm();
            }
          },
          onLanguagesChange: onMailLanguagesChange,
        });
        outlookBanner.start();
      } else {
        outlookBanner.setLabels(mailBannerLabels());
        outlookBanner.setPreferences(outlookPrefs);
      }
    } else if (outlookBanner) {
      outlookBanner.dispose();
      outlookBanner = null;
    }
  };

  const refresh = async (): Promise<void> => {
    const writeId = mailLanguagesWrite;
    const [nextSettings, nextRule] = await Promise.all([loadSettings(), loadSiteRule(host)]);
    liveSettings = {
      ...nextSettings,
      gmailAutoTranslateLangs:
        writeId === mailLanguagesWrite || !liveSettings
          ? nextSettings.gmailAutoTranslateLangs
          : liveSettings.gmailAutoTranslateLangs,
      gmailNeverTranslateLangs:
        writeId === mailLanguagesWrite || !liveSettings
          ? nextSettings.gmailNeverTranslateLangs
          : liveSettings.gmailNeverTranslateLangs,
    };
    sync(liveSettings, nextRule);
  };

  void refresh();
  subscribeSettings(() => {
    void refresh();
  });
  subscribeSiteRules(() => {
    void refresh();
  });
}
