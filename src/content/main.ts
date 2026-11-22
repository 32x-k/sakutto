import { browser } from 'wxt/browser';
import { armFolderCommand } from '@/content/folder-arm-gate';
import { ComposeController, type ComposeLabels, type ComposePreferences } from '@/dom/compose';
import { shouldHandleComposeCommand } from '@/dom/compose-field';
import { detectDocumentLanguage } from '@/dom/detect';
import { fakeTranslate } from '@/dom/fake-engine';
import { FloatingMenuController, type FloatingMenuLabels } from '@/dom/floating-menu';
import { isMailHost } from '@/dom/mail-sites';
import type { OverlayLabels } from '@/dom/overlay';
import {
  PageSession,
  capturePageSelection,
  preferencesFor,
  type PageSelectionSnapshot,
} from '@/dom/session';
import { captionsAllowedOnPage } from '@/captions/sites';
import {
  loadSiteRule,
  pageHost,
  patchSiteRule,
  saveSiteRule,
  subscribeSiteRules,
  type SiteRule,
} from '@/dom/sites';
import {
  isFolderGrantCompleteMessage,
  isFolderGrantNeededMessage,
} from '@/shared/folder-grant-messages';
import { FOLDER_PERMISSION_ERROR } from '@/engine/model/folder-permission';
import { hasLicenseConsent } from '@/shared/agreement';
import { isAndroidPlatform } from '@/shared/browser';
import { sharedFolderNeedsUserAction, type ModelStatus } from '@/shared/engine-status';
import { mergeGlossary } from '@/shared/glossary';
import { readRuntimeLastError } from '@/shared/runtime-last-error';
import { currentUiLanguage, t } from '@/shared/i18n';
import { effectivePageTarget, isTargetLanguage, type TargetLanguage } from '@/shared/languages';
import {
  boundShortcut,
  defaultShortcutEnabled,
  displayShortcut,
  emptyShortcutAssigned,
  inPageFallbackShortcut,
  isMacPlatform,
  matchesShortcut,
  type ShortcutAssigned,
  type ShortcutCommand,
  type ShortcutEnabled,
} from '@/shared/shortcuts';
import {
  isModelProgressMessage,
  isPageCommandRequest,
  isPageInfoRequest,
  isPageStateRequest,
  isShortcutQueryResult,
  requestEngineStatus,
  requestEngineWarm,
  type ContentFeatureName,
  type PageCommandName,
  type PageInfo,
  type ShortcutQueryResult,
  type ShortcutSnapshot,
} from '@/shared/messages';
import { modelRemovalOutcome, modelRemovalStopsTranslation } from '@/shared/model-progress';
import { loadSettings, saveSettings, subscribeSettings } from '@/shared/storage';
import type { Settings } from '@/shared/settings';
import { typedReadiness, type TypedReadiness } from '@/shared/typed-translation';
import { translateViaBackground } from '@/shared/translation-client';
import { installContentPortLifecycle } from '@/shared/content-port-lifecycle';
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

interface ContentBridgeGlobal {
  __sakuttoContentBridgeReady?: boolean;
}

const bridge = globalThis as typeof globalThis & ContentBridgeGlobal;

/**
 * Browser bindings plus the broad-grant state. A page may listen only for an empty binding
 * the browser never assigned, and only while the all-sites grant covers it; an assigned key
 * belongs exclusively to `commands.onCommand` in the background.
 */
async function readShortcutState(): Promise<ShortcutQueryResult | null> {
  const response: unknown = await browser.runtime
    .sendMessage({ type: 'commands:shortcuts' })
    .catch(() => {
      readRuntimeLastError();
      return undefined;
    });
  return isShortcutQueryResult(response) ? response : null;
}

function shortcutFor(
  snapshot: ShortcutSnapshot | null,
  enabled: ShortcutEnabled,
  command: ShortcutCommand,
): string {
  return boundShortcut(snapshot, command, {
    enabled: enabled[command],
    mac: isMacPlatform(),
  });
}

function listensFor(
  snapshot: ShortcutSnapshot | null,
  assigned: ShortcutAssigned,
  enabled: ShortcutEnabled,
  command: ShortcutCommand,
): (event: KeyboardEvent) => boolean {
  return (event) => {
    const shortcut = inPageFallbackShortcut(snapshot, command, {
      enabled: enabled[command],
      assigned: assigned[command],
      mac: isMacPlatform(),
    });
    return shortcut.length > 0 && matchesShortcut(event, shortcut);
  };
}

function composePreferencesFor(
  settings: Settings,
  rule: SiteRule,
  readiness: TypedReadiness,
  replaceShortcut: string,
): ComposePreferences {
  const composeTarget = settings.composeTargetLanguage;
  return {
    targetLanguage: composeTarget ?? rule.targetLanguage ?? settings.targetLanguage,
    form: settings.form,
    glossary: mergeGlossary(settings.glossary, rule.glossary),
    enabled: rule.auto !== 'never',
    uiLanguage: currentUiLanguage(),
    showIcon: settings.composeIcon,
    readiness,
    explicitTarget: composeTarget !== null,
    instantReplace: settings.composeInstantReplace,
    popupSize: settings.translationPopupSize,
    plainTextLineBreaks: settings.plainTextLineBreaks,
    replaceShortcut,
    placement: settings.composePlacement,
    sitePlacement: rule.composePlacement ?? null,
    freePoint: rule.composeFreePoint ?? null,
  };
}

async function requestSiteAccess(host: string): Promise<boolean> {
  const response = await browser.runtime.sendMessage({ type: 'site:grant', host }).catch(() => {
    readRuntimeLastError();
    return false;
  });
  return response === true;
}

function composeLabels(readiness?: TypedReadiness): ComposeLabels {
  const setup =
    readiness === 'no-consent'
      ? t('typedNeedsConsent')
      : readiness === 'model-error'
        ? t('typedModelError')
        : t('composeNeedSetup');
  return {
    title: t('composeTitle'),
    icon: t('composeIcon'),
    replace: t('composeReplace'),
    undo: t('composeUndo'),
    close: t('close'),
    pending: t('composePending'),
    failed: t('composeFailed'),
    empty: t('composeEmpty'),
    tooLong: t('composeTooLong'),
    swap: t('composeSwap'),
    replaced: t('composeReplaced'),
    stale: t('composeStale'),
    setup,
    loading: t('composeLoading'),
    ineligible: t('composeIneligible'),
    openSetup: t('composeOpenSetup'),
    target: t('composeTargetLabel'),
    autoSource: t('composeAutoSource'),
    replaceHint: (compose, enter) => t('composeReplaceHint', [compose, enter]),
    langPair: (source, target) => t('composeLangPair', [source, target]),
    into: (language) => t('composeInto', [language]),
    chromeOnly: (language) => t('composeChromeOnly', [language]),
    placementMenu: t('composePlacementMenu'),
    placementSite: t('composePlacementSite'),
    placementFollowSettings: t('composePlacementFollowSettings'),
    placementReset: t('composePlacementReset'),
    placementHandle: t('composePlacementHandle'),
    placementLabel: (placement) =>
      t(
        placement === 'below'
          ? 'composePlacementBelow'
          : placement === 'corner'
            ? 'composePlacementCorner'
            : placement === 'free'
              ? 'composePlacementFree'
              : 'composePlacementAbove',
      ),
  };
}

function composeReadiness(
  settings: Settings,
  model: Pick<ModelStatus, 'state'> | null,
  ready: boolean,
  statusKnown: boolean,
) {
  if (__SAKUTTO_FAKE_ENGINE__ && settings.engineSource !== 'local-server') return 'ready' as const;
  if (!hasLicenseConsent(settings)) {
    return typedReadiness({
      consent: false,
      modelState: model?.state ?? 'absent',
      plamoReady: ready,
      engineSource: settings.engineSource,
    });
  }
  // A failed status fetch is not "no model"; keep showing loading until we know.
  if (!statusKnown && settings.engineSource !== 'local-server') return 'model-busy' as const;
  return typedReadiness({
    consent: true,
    modelState: model?.state ?? 'absent',
    plamoReady: ready,
    engineSource: settings.engineSource,
  });
}

function overlayLabels(): OverlayLabels {
  return {
    original: t('originalLabel'),
    chromeNote: t('chromeTranslationNote'),
    machine: t('machineTranslationTooltip'),
    selectionPending: t('selectionPending'),
    selectionFailed: t('selectionFailed'),
    selectionTitle: t('selectionTitle'),
    selectionIcon: t('selectionIcon'),
    selectionResize: t('selectionResizeHandle'),
    selectionCopy: t('selectionCopy'),
    selectionCopied: t('selectionCopied'),
    selectionCopyFailed: t('selectionCopyFailed'),
    close: t('close'),
    bilingualOn: t('displayNowBilingual'),
    replaceOn: t('displayNowReplace'),
    barLabel: t('pageProgressLabel'),
    barProgress: (done, total) => t('pageProgress', [String(done), String(total)]),
    barRate: (tokens, segments) => t('pageRate', [tokens, segments]),
    barDone: t('pageTranslated'),
    barPartial: (blocks) => t('pagePartial', [String(blocks)]),
    modelMissing: t('modelSelectionMissing'),
    barOriginal: t('restoreThisPage'),
    barAlways: t('alwaysTranslateSite'),
    engineFailed: t('localServerFailed'),
    folderPermission: t('modelFolderPermissionPage'),
    folderEnableTitle: t('modelFolderEnableOneClick'),
    barAlwaysOn: t('pageAlwaysOn'),
  };
}

function floatingMenuLabels(): FloatingMenuLabels {
  return {
    brand: t('extensionShortName'),
    translatePage: t('translateThisPage'),
    restorePage: t('restoreThisPage'),
    displayReplace: t('displayReplace'),
    displayBilingual: t('displayBilingual'),
    targetLabel: t('targetLanguageLabel'),
    alwaysSite: t('alwaysTranslateSite'),
    openTyped: t('openTyped'),
    openOptions: t('openOptions'),
    hideTab: t('floatingButtonHideTab'),
    close: t('close'),
    pageTranslated: t('pageTranslated'),
    pageProgress: (done, total) => t('pageProgress', [String(done), String(total)]),
    serverError: t('localServerFailed'),
  };
}

function openFolderEnableWindow(): void {
  void browser.runtime.sendMessage({ type: 'folder:open-enable' }).catch(() => {
    readRuntimeLastError();
  });
}

export function contentMain(): void {
  if (bridge.__sakuttoContentBridgeReady) return;
  if (pageHost(location.href) === null) return;
  if (contentExtensionId().length === 0) return;
  bridge.__sakuttoContentBridgeReady = true;

  // The generic content bundle and the idle mail bundle share this isolated world. The
  // guard above makes the second one a no-op; only the winner may claim the page and
  // remove hosts left by an older content-script instance.
  const instanceToken = contentScriptInstanceToken();
  registerLiveContentInstanceToken(instanceToken);
  purgeForeignMailBannerHosts(document, instanceToken);
  claimContentExtensionInstance(document, instanceToken);

  const host = pageHost(location.href) ?? '';
  const android = isAndroidPlatform();
  // Browser bindings label compose UI. Translation commands arrive from the background,
  // except for a never-assigned command on a page the broad all-sites grant keeps covered.
  let shortcutSnapshot: ShortcutSnapshot | null = null;
  let shortcutAssigned = emptyShortcutAssigned();
  // The content world cannot call permissions.contains; the background reports this with
  // the bindings. It stays false until that answer, so an assigned key is never doubled.
  let allSitesAccess = false;
  let shortcutsEnabled = defaultShortcutEnabled();
  let lastCommand = '';
  let lastCommandAt = 0;
  let compose: ComposeController | null = null;
  let floatingMenu: FloatingMenuController | null = null;
  let invalidationToreDown = false;
  // The passive all-sites injection stays quiet on a host the reader turned off. The first
  // explicit popup or command message flips this for the life of the document.
  let explicitActivationSeen = false;
  let selectionOffersSuppressed = false;
  let pendingExistingSelectionOffer = false;
  let languageDetected = false;
  const requestedFeatures = new Set<ContentFeatureName>();
  const ensureContentFeature = (feature: ContentFeatureName): void => {
    if (requestedFeatures.has(feature) || invalidationToreDown) return;
    requestedFeatures.add(feature);
    void browser.runtime
      .sendMessage({ type: 'content:load-feature', feature })
      .then((loaded) => {
        if (loaded !== true) requestedFeatures.delete(feature);
      })
      .catch(() => {
        requestedFeatures.delete(feature);
        readRuntimeLastError();
      });
  };
  const teardownAfterInvalidation = (): void => {
    if (invalidationToreDown) return;
    invalidationToreDown = true;
    compose?.destroy();
    floatingMenu?.dispose();
    compose = null;
    floatingMenu = null;
    unregisterLiveContentInstanceToken(instanceToken);
    removeOwnedMailBannerHosts(document, instanceToken);
    document.documentElement.removeAttribute(CONTENT_INSTANCE_DOC_ATTR);
  };
  installContentPortLifecycle();
  installContentInvalidationCleanup(teardownAfterInvalidation);
  let modelState: ModelStatus['state'] | null = null;
  let activeModelId: ModelStatus['id'] | null = null;
  let modelRemoved = false;
  let folderNeedsUserAction = false;
  let plamoReady = false;
  let modelStatusKnown = false;
  const refreshShortcuts = (): void => {
    void readShortcutState().then((state) => {
      if (!state) return;
      shortcutSnapshot = state.snapshot;
      shortcutAssigned = state.assigned;
      allSitesAccess = state.allSitesAccess === true;
      compose?.setReplaceShortcut(
        displayShortcut(shortcutFor(shortcutSnapshot, shortcutsEnabled, 'translate-compose')),
      );
    });
  };
  let shortcutRefreshTimer = 0;
  const scheduleShortcutRefresh = (): void => {
    window.clearTimeout(shortcutRefreshTimer);
    shortcutRefreshTimer = window.setTimeout(refreshShortcuts, 80);
  };
  if (!android) {
    refreshShortcuts();
    // Keep the compose label current after a visit to the browser's shortcut editor.
    window.addEventListener('focus', scheduleShortcutRefresh);
    document.addEventListener('visibilitychange', scheduleShortcutRefresh);
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) scheduleShortcutRefresh();
    });
  }

  let engineSource: Settings['engineSource'] = 'in-browser';
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

  /**
   * An explicit popup or command reached this page. On a host whose rule is `never`, the
   * passive all-sites injection has kept the selection button hidden; an explicit gesture
   * keeps today's behavior, so the offers return from here on. The popup and the command
   * paths both message the page right after `ensureContentScript` confirms it answers.
   */
  const markExplicitPageActivation = (): void => {
    if (explicitActivationSeen) return;
    explicitActivationSeen = true;
    void sessionPromise.then((session) => {
      if (!selectionOffersSuppressed) return;
      selectionOffersSuppressed = false;
      session.setSelectionOffersSuppressed(false);
      if (!pendingExistingSelectionOffer) return;
      pendingExistingSelectionOffer = false;
      session.offerExistingSelection();
    });
  };

  const pageCommandBridge: {
    deliver: ((command: PageCommandName, source?: EventTarget | null) => void) | null;
    ensureCompose: ((nextSettings: Settings, nextRule: SiteRule) => ComposeController) | null;
    syncOptionalFeatures: ((nextSettings: Settings, nextRule: SiteRule) => void) | null;
  } = {
    deliver: null,
    ensureCompose: null,
    syncOptionalFeatures: null,
  };

  const sessionPromise = (async () => {
    const settings = await loadSettings();
    let liveSettings = settings;
    let popupWidthWrite = 0;
    engineSource = settings.engineSource;
    const rule = await loadSiteRule(host);
    const readModelStatus = async (): Promise<boolean> => {
      const status = await requestEngineStatus().catch(() => null);
      if (!status) return false;
      modelState = status.model.state;
      activeModelId = status.model.id;
      folderNeedsUserAction = sharedFolderNeedsUserAction(status);
      plamoReady = status.plamoReady;
      modelStatusKnown = true;
      return true;
    };
    if (!__SAKUTTO_FAKE_ENGINE__) {
      // Local server mode does not depend on in-browser model files or folder grants, so
      // avoid waking the background/offscreen host on every normal page load.
      if (settings.engineSource === 'local-server') {
        plamoReady = true;
        folderNeedsUserAction = false;
        modelStatusKnown = true;
      } else {
        await readModelStatus();
      }
    }
    shortcutsEnabled = settings.shortcutsEnabled;
    const session = new PageSession(document, {
      engine,
      labels: overlayLabels(),
      folderGrantUiActive: folderNeedsUserAction,
      onFolderEnable: openFolderEnableWindow,
      preferences: preferencesFor(settings, rule, host),
      onSitePatch: async (patch) => {
        const current = await loadSiteRule(host);
        await saveSiteRule({ ...current, ...patch, host });
      },
      onGrantSite: () => requestSiteAccess(host),
      onPopupWidth: (width) => {
        popupWidthWrite += 1;
        liveSettings = { ...liveSettings, translationPopupWidth: width };
        void saveSettings({ translationPopupWidth: width });
      },
      pageKey: (event) =>
        allSitesAccess &&
        !android &&
        listensFor(shortcutSnapshot, shortcutAssigned, shortcutsEnabled, 'translate-page')(event),
      bilingualKey: (event) =>
        allSitesAccess &&
        !android &&
        listensFor(shortcutSnapshot, shortcutAssigned, shortcutsEnabled, 'toggle-bilingual')(event),
      selectionKey: (event) =>
        allSitesAccess &&
        !android &&
        listensFor(
          shortcutSnapshot,
          shortcutAssigned,
          shortcutsEnabled,
          'translate-selection',
        )(event),
      onPageCommand: (command) => pageCommandBridge.deliver?.(command),
    });

    const createCompose = (
      targetSettings: Settings,
      targetRule: SiteRule,
      readiness: TypedReadiness,
    ): ComposeController =>
      new ComposeController(document, {
        engine,
        labels: composeLabels(readiness),
        preferences: composePreferencesFor(
          targetSettings,
          targetRule,
          readiness,
          displayShortcut(shortcutFor(shortcutSnapshot, shortcutsEnabled, 'translate-compose')),
        ),
        composeKey: (event) =>
          allSitesAccess &&
          !android &&
          listensFor(
            shortcutSnapshot,
            shortcutAssigned,
            shortcutsEnabled,
            'translate-compose',
          )(event),
        onComposeCommand: (source) => pageCommandBridge.deliver?.('compose', source),
        onWarm: () => {
          if (!__SAKUTTO_FAKE_ENGINE__ && liveSettings.engineSource !== 'local-server') {
            void requestEngineWarm();
          }
        },
        onSetup: () => {
          void browser.runtime.sendMessage({ type: 'ui:open-setup' }).catch(() => {
            readRuntimeLastError();
          });
        },
        onTarget: (language: TargetLanguage) => {
          if (!isTargetLanguage(language)) return;
          void saveSettings({ composeTargetLanguage: language });
        },
        onPlacement: (placement) => {
          void patchSiteRule(host, (current) => {
            const next = { ...current, host, composePlacement: placement };
            if (placement !== 'free') delete next.composeFreePoint;
            return next;
          });
        },
        onFollowSettings: () => {
          void patchSiteRule(host, (current) => {
            const next = { ...current, host };
            delete next.composePlacement;
            delete next.composeFreePoint;
            return next;
          });
        },
        onFreePoint: (point) => {
          void patchSiteRule(host, (current) => {
            const next = { ...current, host };
            if (point) {
              next.composePlacement = 'free';
              next.composeFreePoint = point;
            } else {
              delete next.composeFreePoint;
            }
            return next;
          });
        },
      });

    const syncCompose = (
      targetSettings: Settings,
      targetRule: SiteRule,
      readiness: TypedReadiness,
    ): void => {
      // On Android there are no browser keyboard shortcuts or desktop context menus, so
      // keep ComposeController completely unloaded while the compose button setting is off.
      if (android && !targetSettings.composeIcon) {
        compose?.destroy();
        compose = null;
        return;
      }
      if (!compose) {
        compose = createCompose(targetSettings, targetRule, readiness);
        return;
      }
      compose.setLabels(composeLabels(readiness));
      compose.setPreferences(
        composePreferencesFor(
          targetSettings,
          targetRule,
          readiness,
          displayShortcut(shortcutFor(shortcutSnapshot, shortcutsEnabled, 'translate-compose')),
        ),
      );
    };

    pageCommandBridge.ensureCompose = (targetSettings, targetRule) => {
      if (!compose) {
        const currentReadiness = composeReadiness(
          targetSettings,
          modelState ? { state: modelState } : null,
          plamoReady,
          modelStatusKnown,
        );
        compose = createCompose(targetSettings, targetRule, currentReadiness);
      }
      return compose;
    };

    const readiness = composeReadiness(
      settings,
      modelState ? { state: modelState } : null,
      plamoReady,
      modelStatusKnown,
    );
    syncCompose(settings, rule, readiness);

    let liveRule = rule;
    // A passive all-sites injection must not surface the selection button on a host the
    // reader turned Sakutto off for. An explicit activation (recorded by the message
    // listener) or a rule change lifts it again; the explicit command paths still run.
    const syncSelectionSuppression = (): void => {
      const suppress = liveRule.auto === 'never' && !explicitActivationSeen;
      if (suppress === selectionOffersSuppressed) return;
      selectionOffersSuppressed = suppress;
      session.setSelectionOffersSuppressed(suppress);
      if (!suppress && pendingExistingSelectionOffer) {
        pendingExistingSelectionOffer = false;
        session.offerExistingSelection();
      }
    };
    syncSelectionSuppression();

    const syncOptionalFeatures = (targetSettings: Settings, targetRule: SiteRule): void => {
      if (
        targetSettings.translateVideoCaptions &&
        targetRule.auto !== 'never' &&
        captionsAllowedOnPage(host, targetSettings.captionCustomHosts, document)
      ) {
        ensureContentFeature('captions');
      }
      if (targetSettings.gmailTranslateBanner && isMailHost(host) && targetRule.auto !== 'always') {
        ensureContentFeature('mail');
      }
    };
    pageCommandBridge.syncOptionalFeatures = syncOptionalFeatures;
    syncOptionalFeatures(liveSettings, liveRule);

    floatingMenu = new FloatingMenuController(document, {
      labels: floatingMenuLabels(),
      preferences: {
        mode: liveSettings.floatingButton,
        position: liveSettings.floatingButtonPosition,
        uiLanguage: currentUiLanguage(),
      },
      callbacks: {
        onTogglePage: () => {
          markExplicitPageActivation();
          pageCommandBridge.deliver?.('toggle');
        },
        onToggleBilingual: () => {
          markExplicitPageActivation();
          pageCommandBridge.deliver?.('bilingual');
        },
        onChangeTarget: (language) => {
          liveSettings = { ...liveSettings, targetLanguage: language };
          void saveSettings({ targetLanguage: language });
          if (liveRule.targetLanguage !== undefined) {
            const nextRule = { ...liveRule, host };
            delete nextRule.targetLanguage;
            liveRule = nextRule;
            void saveSiteRule(nextRule);
          }
          session.setPreferences(preferencesFor(liveSettings, liveRule, host));
          floatingMenu?.refresh();
        },
        onToggleAlways: (always) => {
          const auto = always ? 'always' : 'ask';
          liveRule = { ...liveRule, host, auto };
          void saveSiteRule(liveRule);
          session.setPreferences(preferencesFor(liveSettings, liveRule, host));
          if (always) {
            markExplicitPageActivation();
            if (!session.state().active) pageCommandBridge.deliver?.('toggle');
          }
          floatingMenu?.refresh();
        },
        onOpenTyped: () => {
          void browser.runtime.sendMessage({ type: 'ui:open-typed' }).catch(() => {
            readRuntimeLastError();
          });
        },
        onOpenOptions: () => {
          void browser.runtime.sendMessage({ type: 'ui:open-options' }).catch(() => {
            readRuntimeLastError();
          });
        },
        onPositionChange: (position) => {
          liveSettings = { ...liveSettings, floatingButtonPosition: position };
          void saveSettings({ floatingButtonPosition: position });
        },
        readState: () => {
          const view = session.state();
          return {
            active: view.active,
            display: view.display,
            pending: view.pending,
            done: view.done,
            total: view.total,
            auto: liveRule.auto,
            serverFault: view.serverFault === true,
            targetLanguage: effectivePageTarget(
              liveSettings.targetLanguage,
              liveRule.targetLanguage,
            ),
          };
        },
      },
    });

    // Defer DOM language detection until a page translation is requested, unless this site
    // is configured to translate automatically on arrival.
    if (rule.auto === 'always') {
      languageDetected = true;
      session.setDetectedLanguage(await detectDocumentLanguage(document));
    }

    // A selection made before this script initialized never fired `selectionchange` here.
    // Offer the existing highlight once — on every injection path, never as a page
    // translation — so a highlight made just before init still gets the button.
    if (selectionOffersSuppressed) pendingExistingSelectionOffer = true;
    else session.offerExistingSelection();

    const applyStored = async (): Promise<void> => {
      const popupWidthId = popupWidthWrite;
      const previousEngineSource = engineSource;
      const [nextSettings, nextRule] = await Promise.all([loadSettings(), loadSiteRule(host)]);
      const popupWidth =
        popupWidthId === popupWidthWrite
          ? nextSettings.translationPopupWidth
          : liveSettings.translationPopupWidth;
      liveSettings = {
        ...nextSettings,
        translationPopupWidth: popupWidth,
      };
      liveRule = nextRule;
      syncSelectionSuppression();
      engineSource = liveSettings.engineSource;
      if (engineSource === 'local-server') {
        plamoReady = true;
        folderNeedsUserAction = false;
        modelStatusKnown = true;
        session.setFolderGrantUiActive(false);
      } else if (previousEngineSource === 'local-server' && !__SAKUTTO_FAKE_ENGINE__) {
        modelStatusKnown = false;
        void readModelStatus().then((ok) => {
          if (ok) {
            session.setFolderGrantUiActive(folderNeedsUserAction);
            void applyStored();
          }
        });
      }
      shortcutsEnabled = liveSettings.shortcutsEnabled;
      session.setLabels(overlayLabels());
      session.setPreferences(preferencesFor(liveSettings, liveRule, host));
      const readiness = composeReadiness(
        liveSettings,
        modelState ? { state: modelState } : null,
        plamoReady,
        modelStatusKnown,
      );
      syncCompose(liveSettings, liveRule, readiness);
      syncOptionalFeatures(liveSettings, liveRule);
      floatingMenu?.setLabels(floatingMenuLabels());
      floatingMenu?.setPreferences({
        mode: liveSettings.floatingButton,
        position: liveSettings.floatingButtonPosition,
        uiLanguage: currentUiLanguage(),
      });
    };

    subscribeSettings(() => {
      void applyStored();
    });
    subscribeSiteRules(() => {
      void applyStored();
    });

    // A status fetch can land while the offscreen host is still opening. Retry a few times
    // instead of leaving compose on "loading" until the next model-progress event; after
    // that, show the setup/error state rather than claiming a load is still running.
    let statusRetries = 0;
    const retryModelStatus = async (): Promise<void> => {
      if (modelStatusKnown || __SAKUTTO_FAKE_ENGINE__) return;
      if (await readModelStatus()) {
        await applyStored();
        return;
      }
      statusRetries += 1;
      if (statusRetries >= 4) {
        modelStatusKnown = true;
        await applyStored();
        return;
      }
      window.setTimeout(() => void retryModelStatus(), 500 * 2 ** (statusRetries - 1));
    };
    if (!modelStatusKnown && !__SAKUTTO_FAKE_ENGINE__) {
      window.setTimeout(() => void retryModelStatus(), 500);
    }

    if (rule.auto === 'always') {
      if (!__SAKUTTO_FAKE_ENGINE__ && liveSettings.engineSource !== 'local-server') {
        void requestEngineWarm();
        void requestEngineTier(session, false);
      }
      void session.translate();
    }
    return session;
  })();

  /** Refresh the folder-grant gate after a model/folder transition, not on every chunk. */
  const refreshFolderGrantUi = async (): Promise<void> => {
    const status = await requestEngineStatus().catch(() => null);
    if (!status) return;
    folderNeedsUserAction = sharedFolderNeedsUserAction(status);
    const session = await sessionPromise;
    session.setFolderGrantUiActive(folderNeedsUserAction);
  };

  const run = async (
    command: PageCommandName,
    selection?: PageSelectionSnapshot | null,
    source?: EventTarget | null,
  ) => {
    const now = Date.now();
    // Compose re-entry is owned by the controller so a Chrome command that found no field
    // cannot swallow the page keydown (or a second command) that does.
    if (command !== 'compose' && lastCommand === command && now - lastCommandAt < 80) {
      return (await sessionPromise).state();
    }
    lastCommand = command;
    lastCommandAt = now;
    const session = await sessionPromise;
    const [liveSettings, liveRule] = await Promise.all([loadSettings(), loadSiteRule(host)]);
    pageCommandBridge.syncOptionalFeatures?.(liveSettings, liveRule);
    // Keyboard assignment is enforced by `commands.onCommand`. This path also serves the
    // popup and context menu.
    if (!__SAKUTTO_FAKE_ENGINE__ && liveSettings.engineSource !== 'local-server') {
      void requestEngineWarm();
      void requestEngineTier(session, false);
    }
    if (command === 'compose') {
      if (shouldHandleComposeCommand(document)) {
        const controller = compose ?? pageCommandBridge.ensureCompose?.(liveSettings, liveRule);
        controller?.handleShortcut(source);
      }
      return session.state();
    }
    const armed = await armFolderCommand(command);
    if (armed === 'deferred') {
      session.beginFolderGrantWait();
      return session.state();
    }
    if (command === 'selection' && selection) {
      // The menu may have collapsed the document selection while the arm round-trip ran.
      session.translateSelection(selection.text, selection.rect);
      return session.state();
    }
    if (!languageDetected && (command === 'toggle' || command === 'bilingual')) {
      languageDetected = true;
      session.setDetectedLanguage(await detectDocumentLanguage(document));
    }
    await session.handle(command);
    return session.state();
  };
  pageCommandBridge.deliver = (command, source) => {
    const selection = command === 'selection' ? capturePageSelection(document) : null;
    void run(command, selection, source);
  };

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return;
    if (isFolderGrantCompleteMessage(message)) {
      void sessionPromise.then(async (session) => {
        session.endFolderGrantWait();
        await refreshFolderGrantUi();
      });
      return;
    }
    if (isFolderGrantNeededMessage(message)) {
      folderNeedsUserAction = true;
      void sessionPromise.then((session) => {
        session.setFolderGrantUiActive(true);
        session.beginFolderGrantWait();
      });
      return;
    }
    if (isPageInfoRequest(message)) {
      sendResponse({ lang: document.documentElement.lang } satisfies PageInfo);
      return;
    }
    if (isModelProgressMessage(message)) {
      const status = message.status;
      // `ready` now reaches pages too. Ignore one for a model that is merely installed but
      // not the active translation model; only a delete recovery may adopt a different id.
      if (
        status.state === 'ready' &&
        !modelRemoved &&
        activeModelId !== null &&
        status.id !== activeModelId
      ) {
        return;
      }
      const removedActiveModel =
        status.state === 'absent' && (activeModelId === null || status.id === activeModelId);
      const modelReturned = modelRemoved && (status.state === 'loaded' || status.state === 'ready');

      if (status.state === 'absent') {
        if (removedActiveModel) {
          activeModelId = null;
          modelState = 'absent';
          modelStatusKnown = true;
          plamoReady = false;
          modelRemoved = true;
        }
      } else {
        modelState = status.state;
        modelStatusKnown = true;
        if (status.state === 'loaded' || status.state === 'ready') {
          activeModelId = status.id;
          if (status.state === 'loaded') plamoReady = true;
        }
      }
      if (modelReturned) modelRemoved = false;

      void sessionPromise.then(async (session) => {
        const [nextSettings, nextRule] = await Promise.all([loadSettings(), loadSiteRule(host)]);
        const readiness = composeReadiness(nextSettings, message.status, plamoReady, true);
        compose?.setLabels(composeLabels(readiness));
        compose?.setPreferences(
          composePreferencesFor(
            nextSettings,
            nextRule,
            readiness,
            displayShortcut(shortcutFor(shortcutSnapshot, shortcutsEnabled, 'translate-compose')),
          ),
        );
        let missingAfterRemoval = false;
        // A local server never reads the GGUF file, so deleting every in-browser model
        // leaves its pages translating. Only the in-browser engine loses its file here.
        if (
          removedActiveModel &&
          modelRemoved &&
          modelRemovalStopsTranslation(nextSettings.engineSource)
        ) {
          const current = await requestEngineStatus().catch(() => null);
          if (current && modelRemovalOutcome(status, current.model) === 'recovered') {
            activeModelId = current.model.id;
            modelState = current.model.state;
            modelStatusKnown = true;
            plamoReady = current.plamoReady;
            folderNeedsUserAction = sharedFolderNeedsUserAction(current);
            modelRemoved = false;
            session.setFolderGrantUiActive(folderNeedsUserAction);
            session.retryUntranslated();
          } else {
            missingAfterRemoval = true;
          }
        }
        if (missingAfterRemoval) session.noteModelMissing();
        if (modelReturned) session.retryUntranslated();
        if (message.status.error === FOLDER_PERMISSION_ERROR) {
          folderNeedsUserAction = true;
          session.setFolderGrantUiActive(true);
          session.noteFolderPermission();
        }
        if (
          (message.status.state === 'loaded' || message.status.state === 'ready') &&
          !__SAKUTTO_FAKE_ENGINE__
        ) {
          void requestEngineTier(session, true);
          if (!removedActiveModel) await refreshFolderGrantUi();
        }
      });
      return;
    }
    if (isPageStateRequest(message)) {
      // Only the popup asks for page state: this is an explicit look at the page.
      markExplicitPageActivation();
      void sessionPromise.then(async (session) => {
        if (!languageDetected) {
          languageDetected = true;
          session.setDetectedLanguage(await detectDocumentLanguage(document));
        }
        sendResponse(session.state());
      });
      return true;
    }
    if (!isPageCommandRequest(message)) return;
    // A command is the popup, a context menu, or an assigned browser command.
    markExplicitPageActivation();
    // Capture before the first await: opening a context menu can clear the selection while
    // the background arm round-trip is still running.
    const selection = message.command === 'selection' ? capturePageSelection(document) : null;
    void sessionPromise.then(async () => {
      sendResponse(await run(message.command, selection));
    });
    return true;
  });
}

async function requestEngineTier(session: PageSession, retry = false): Promise<void> {
  try {
    const status = await requestEngineStatus();
    if (status?.tier) {
      session.setTier(status.tier);
    }
    if (retry || status?.model.state === 'loaded') session.retryUntranslated();
  } catch {
    // A load broadcast still re-queues the blocks that failed while the model loaded.
    if (retry) session.retryUntranslated();
  }
}
