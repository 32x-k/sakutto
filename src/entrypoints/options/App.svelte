<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import type { GlossaryEntry } from '@/engine/types';
  import type { SiteAuto, SiteRule } from '@/dom/sites';
  import {
    deleteSiteRule,
    loadSiteRules,
    pageHost,
    saveSiteRule,
    subscribeSiteRules,
  } from '@/dom/sites';
  import type { EngineStatus } from '@/shared/engine-status';
  import { isAndroidPlatform, isFirefoxBuild } from '@/shared/browser';
  import { openOrFocusExtensionTab } from '@/shared/extension-tabs';
  import { currentUiLanguage, t, tForBrowser } from '@/shared/i18n';
  import { requestCacheClear, requestEngineStatus } from '@/shared/messages';
  import { PLAMO_OFFICIAL_LINKS, PROJECT_LINKS } from '@/shared/plamo-license';
  import type { Settings, SettingsPatch } from '@/shared/settings';
  import type { TargetLanguage } from '@/shared/languages';
  import { settleCaptionEnableIntent } from '@/captions/sites';
  import { loadSettings, saveSettings, subscribeSettings } from '@/shared/storage';
  import LanguageField from '@/ui/LanguageField.svelte';
  import GlossaryEditor from '@/ui/GlossaryEditor.svelte';
  import SettingsFields from '@/ui/SettingsFields.svelte';
  import ShortcutSettings from '@/ui/ShortcutSettings.svelte';
  import LocalServerSettings from '@/ui/LocalServerSettings.svelte';

  const android = isAndroidPlatform();

  type SettingsError = 'load' | 'save' | null;
  type CacheState = 'cleared' | 'failed' | null;

  const licenseLinks = {
    plamoJa: browser.runtime.getURL('/licenses/PLaMo-Community-License-ja.txt'),
    plamoEn: browser.runtime.getURL('/licenses/PLaMo-Community-License-en.txt'),
    mit: browser.runtime.getURL('/licenses/LICENSE.txt'),
    notice: browser.runtime.getURL('/licenses/NOTICE.txt'),
  };

  const officialLinks = PLAMO_OFFICIAL_LINKS;
  const projectLinks = PROJECT_LINKS;

  let settings = $state<Settings | null>(null);
  let settingsError = $state<SettingsError>(null);
  let uiLanguage = $state(currentUiLanguage());
  let rules = $state<Record<string, SiteRule>>({});
  let hostInput = $state('');
  let hostError = $state(false);
  let glossaryScope = $state('global');
  let permissionError = $state(false);
  let engine = $state<EngineStatus | null>(null);
  let cacheState = $state<CacheState>(null);
  let actionFailed = $state(false);

  let siteList = $derived(
    Object.values(rules).sort((left, right) => left.host.localeCompare(right.host)),
  );
  let glossaryEntries = $derived(
    glossaryScope === 'global'
      ? (settings?.glossary ?? [])
      : (rules[glossaryScope]?.glossary ?? []),
  );

  async function updateSettings(patch: SettingsPatch) {
    try {
      settings = await saveSettings(patch);
      settingsError = null;
      if (
        patch.engineSource !== undefined ||
        patch.localServerParallel !== undefined ||
        patch.localServerUrl !== undefined
      ) {
        engine = await requestEngineStatus();
      }
    } catch {
      settingsError = 'save';
    }
  }

  async function loadStoredSettings() {
    try {
      const loaded = await loadSettings();
      if (loaded.engineSource !== 'local-server' || !loaded.localServerExperimentalAck) {
        settings = await saveSettings({
          engineSource: 'local-server',
          localServerExperimentalAck: true,
        });
      } else {
        settings = loaded;
      }
      settingsError = null;
    } catch {
      settingsError = 'load';
    }
  }

  async function loadRules() {
    rules = await loadSiteRules();
  }

  async function patchSite(host: string, patch: Partial<SiteRule>) {
    const current = rules[host];
    if (!current) return;
    await saveSiteRule({ ...current, ...patch, host });
    await loadRules();
  }

  async function changeAuto(host: string, auto: SiteAuto) {
    permissionError = false;
    if (auto === 'always') {
      const granted = await browser.permissions
        .request({ origins: [`https://${host}/*`, `http://${host}/*`] })
        .catch(() => false);
      if (!granted) {
        permissionError = true;
        return;
      }
    }
    const current = rules[host];
    if (!current) return;
    await saveSiteRule({ ...current, auto });
    await loadRules();
  }

  async function addSite() {
    const host = pageHost(`https://${hostInput.trim()}`);
    hostError = host === null;
    if (!host) return;
    const current = rules[host] ?? { host, auto: 'ask' as const };
    await saveSiteRule(current);
    hostInput = '';
    glossaryScope = host;
    await loadRules();
  }

  async function removeSite(host: string) {
    await deleteSiteRule(host);
    // The glossary editor cannot scope to a rule that no longer exists.
    if (glossaryScope === host) glossaryScope = 'global';
    await loadRules();
  }

  async function saveGlossary(entries: GlossaryEntry[]) {
    if (glossaryScope === 'global') {
      await updateSettings({ glossary: entries });
      return;
    }
    const current = rules[glossaryScope];
    if (!current) return;
    await saveSiteRule({ ...current, host: glossaryScope, glossary: entries });
    await loadRules();
  }

  async function clearCache() {
    cacheState = (await requestCacheClear()) ? 'cleared' : 'failed';
  }

  async function openOnboarding() {
    actionFailed = false;
    if ((await openOrFocusExtensionTab('/onboarding.html')) === null) actionFailed = true;
  }

  async function openTyped() {
    actionFailed = false;
    try {
      await browser.tabs.create({ url: browser.runtime.getURL('/typed.html') });
    } catch {
      actionFailed = true;
    }
  }

  onMount(() => {
    const unsubscribe = subscribeSettings((next) => {
      settings = next;
      settingsError = null;
    });
    const unsubscribeRules = subscribeSiteRules((next) => {
      rules = next;
    });
    void settleCaptionEnableIntent().then((settled) => {
      if (settled.applied) void loadStoredSettings();
    });
    void loadStoredSettings();
    void loadRules();
    void requestEngineStatus().then((status) => {
      if (status) engine = status;
    });
    return () => {
      unsubscribe();
      unsubscribeRules();
    };
  });
</script>

<main class="page">
  <header class="page-header">
    <p class="eyebrow">{t('optionsTitle')}</p>
    <h1>{t('extensionName')}</h1>
    <p class="muted">{t('optionsLead')}</p>
  </header>

  <section class="panel">
    <h2>{t('settingsLabel')}</h2>
    {#if settings}
      <SettingsFields
        {settings}
        {uiLanguage}
        onChange={updateSettings}
        onPermissionDenied={() => {
          permissionError = true;
        }}
      />
      <p class="muted help">{t('optionsDefaultHint')}</p>
      {#if settingsError === 'save'}
        <p class="error" role="alert">{t('errorSaveSettings')}</p>
      {/if}
    {:else if settingsError === 'load'}
      <p class="error" role="alert">{t('errorSettings')}</p>
      <button class="link-button" type="button" onclick={loadStoredSettings}>{t('retry')}</button>
    {:else}
      <p class="muted">{t('statusChecking')}</p>
    {/if}
  </section>

  <section class="panel" id="engine-settings">
    <h2>{t('engineHeading')}</h2>
    {#if settings}
      <LocalServerSettings {settings} onUpdate={updateSettings} />
    {/if}
    <div class="cache-row">
      <button class="button secondary" type="button" onclick={clearCache}>{t('cacheClear')}</button>
      {#if cacheState === 'cleared'}
        <p class="muted" role="status">{t('cacheCleared')}</p>
      {:else if cacheState === 'failed'}
        <p class="error" role="alert">{t('cacheClearFailed')}</p>
      {/if}
    </div>
    <details class="more diag-details">
      <summary>{t('diagHeading')}</summary>
      <dl class="diag">
        <div>
          <dt>{t('diagBackend')}</dt>
          <dd>{t('diagBackendLocalServer')}</dd>
        </div>
        <div>
          <dt>{t('diagConcurrent')}</dt>
          <dd>
            {engine?.engineSource === 'local-server'
              ? (engine.parallel ?? settings?.localServerParallel ?? '—')
              : (settings?.localServerParallel ?? '—')}
          </dd>
        </div>
      </dl>
    </details>
  </section>

  {#if !android}
    <details class="panel collapsible">
      <summary class="panel-summary"><h2>{t('shortcutHeading')}</h2></summary>
      <div class="collapsible-body">
        <p class="muted help">{t(isFirefoxBuild() ? 'shortcutHelpFirefox' : 'shortcutHelp')}</p>
        <p class="muted help">{t('composeHelp')}</p>
        <ShortcutSettings
          enabled={settings?.shortcutsEnabled}
          onToggle={(command, on) => {
            void updateSettings({ shortcutsEnabled: { [command]: on } });
          }}
        />
      </div>
    </details>
  {/if}

  <details class="panel collapsible" open={siteList.length > 0}>
    <summary class="panel-summary">
      <h2>{t('siteRulesHeading')}</h2>
      {#if siteList.length > 0}
        <span class="count-badge">{siteList.length}</span>
      {/if}
    </summary>
    <div class="collapsible-body">
      <p class="muted help">{t('optionsSiteLive')}</p>
      {#if siteList.length === 0}
        <p class="muted">{t('noSiteRules')}</p>
      {:else}
        <ul class="sites">
          {#each siteList as rule (rule.host)}
            <li>
              <span class="site-host">{rule.host}</span>
              <div class="site-controls">
                <LanguageField
                  value={rule.targetLanguage ?? settings?.targetLanguage ?? 'en'}
                  {uiLanguage}
                  onChange={(language: TargetLanguage) => {
                    void patchSite(rule.host, { targetLanguage: language });
                  }}
                />
                <label class="field">
                  <span>{t('displayLabel')}</span>
                  <select
                    aria-label={`${rule.host} ${t('displayLabel')}`}
                    value={rule.display ?? settings?.display ?? 'replace'}
                    onchange={(event) => {
                      const select = event.currentTarget as HTMLSelectElement;
                      void patchSite(rule.host, {
                        display: select.value === 'bilingual' ? 'bilingual' : 'replace',
                      });
                    }}
                  >
                    <option value="replace">{t('displayReplace')}</option>
                    <option value="bilingual">{t('displayBilingual')}</option>
                  </select>
                </label>
                <label class="field">
                  <span>{t('siteRulesHeading')}</span>
                  <select
                    aria-label={`${rule.host} ${t('siteRulesHeading')}`}
                    value={rule.auto}
                    onchange={(event) => {
                      const select = event.currentTarget as HTMLSelectElement;
                      const auto =
                        select.value === 'always' || select.value === 'never'
                          ? select.value
                          : 'ask';
                      void changeAuto(rule.host, auto);
                    }}
                  >
                    <option value="ask">{t('siteRuleAsk')}</option>
                    <option value="always">{t('siteRuleAlways')}</option>
                    <option value="never">{t('siteRuleNever')}</option>
                  </select>
                </label>
                <button
                  class="button secondary site-remove"
                  type="button"
                  aria-label={`${rule.host} ${t('siteRuleRemove')}`}
                  onclick={() => {
                    void removeSite(rule.host);
                  }}
                >
                  {t('siteRuleRemove')}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
      {#if permissionError}
        <p class="error" role="alert">{t('errorPermission')}</p>
      {/if}
      <form
        class="add-site"
        onsubmit={(event) => {
          event.preventDefault();
          void addSite();
        }}
      >
        <label>
          <span>{t('siteHostLabel')}</span>
          <input bind:value={hostInput} autocomplete="off" spellcheck="false" />
        </label>
        <button class="button secondary" type="submit">{t('glossaryAddSite')}</button>
      </form>
      {#if hostError}
        <p class="error" role="alert">{t('siteHostInvalid')}</p>
      {/if}
    </div>
  </details>

  <details class="panel collapsible" open={glossaryEntries.length > 0}>
    <summary class="panel-summary">
      <h2>{t('glossaryHeading')}</h2>
      {#if glossaryEntries.length > 0}
        <span class="count-badge">{glossaryEntries.length}</span>
      {/if}
    </summary>
    <div class="collapsible-body">
      <p id="glossary-help" class="muted help">{t('glossaryHelp')}</p>
      <label class="field">
        <span>{t('glossaryScopeLabel')}</span>
        <select bind:value={glossaryScope}>
          <option value="global">{t('glossaryGlobal')}</option>
          {#each siteList as rule (rule.host)}
            <option value={rule.host}>{rule.host}</option>
          {/each}
        </select>
      </label>
      <GlossaryEditor
        entries={glossaryEntries}
        describedBy="glossary-help"
        onChange={(entries) => void saveGlossary(entries)}
      />
    </div>
  </details>

  <details class="panel collapsible">
    <summary class="panel-summary">
      <h2>{t('privacyHeading')} / {t('licensesHeading')}</h2>
    </summary>
    <div class="collapsible-body">
      <h3>{t('privacyHeading')}</h3>
      <p>{t('privacyBody')}</p>
      <p class="muted">{t('privacyBodyLocalServer')}</p>
      <p class="muted">{tForBrowser('privacyDestinations', 'privacyDestinationsFirefox')}</p>
      <ul class="links">
        <li>
          <a href={projectLinks.privacy} target="_blank" rel="noreferrer"
            >{t('privacyPolicyLink')}</a
          >
        </li>
        <li>
          <a href={projectLinks.source} target="_blank" rel="noreferrer">{t('sourceCodeLink')}</a>
        </li>
      </ul>

      <h3>{t('licensesHeading')}</h3>
      <p>{t('licensesBody')}</p>
      <h4>{t('onboardingCommercialHeading')}</h4>
      <div class="terms">
        <div>
          <h4>{t('onboardingPersonalHeading')}</h4>
          <p class="muted">{t('onboardingPersonalBody')}</p>
        </div>
        <div>
          <h4>{t('onboardingCommercialHeading2')}</h4>
          <p class="muted">{t('onboardingCommercialBody')}</p>
          <ul class="conditions">
            <li>{t('onboardingCommercialRegistration')}</li>
            <li>{t('onboardingCommercialRevenue')}</li>
          </ul>
        </div>
        <div>
          <h4>{t('onboardingCommercialUnmetHeading')}</h4>
          <p class="muted">{t('onboardingCommercialUnmetBody')}</p>
        </div>
      </div>
      <p class="muted">{t('onboardingAgeNotice')}</p>
      <details class="more">
        <summary>{t('onboardingOtherLicenses')}</summary>
        <ul class="links">
          <li>
            <a href={officialLinks.licenseJa} target="_blank" rel="noreferrer"
              >{t('plamoOfficialLicenseJa')}</a
            >
          </li>
          <li>
            <a href={officialLinks.licenseEn} target="_blank" rel="noreferrer"
              >{t('plamoOfficialLicenseEn')}</a
            >
          </li>
          <li>
            <a href={officialLinks.registration} target="_blank" rel="noreferrer"
              >{t('plamoRegistrationLink')}</a
            >
          </li>
          <li>
            <a href={licenseLinks.plamoJa} target="_blank" rel="noreferrer">{t('licensePlaMoJa')}</a
            >
          </li>
          <li>
            <a href={licenseLinks.plamoEn} target="_blank" rel="noreferrer">{t('licensePlaMoEn')}</a
            >
          </li>
          <li><a href={licenseLinks.mit} target="_blank" rel="noreferrer">{t('licenseMit')}</a></li>
          <li>
            <a href={licenseLinks.notice} target="_blank" rel="noreferrer">{t('licenseNotice')}</a>
          </li>
        </ul>
      </details>
      <p class="muted">{t('licenseModelNote')}</p>
    </div>
  </details>

  <div class="actions">
    <button class="button" type="button" onclick={openOnboarding}>{t('openOnboarding')}</button>
    <button class="button secondary" type="button" onclick={openTyped}>{t('openTyped')}</button>
  </div>
  {#if actionFailed}
    <p class="error" role="alert">{t('errorAction')}</p>
  {/if}

  <footer class="footer">
    <p class="notice">{t('machineTranslationNotice')}</p>
    <p class="notice">{t('unofficialNotice')}</p>
  </footer>
</main>

<style>
  .page {
    display: grid;
    gap: var(--space-4);
    max-width: 640px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
  }

  .page-header,
  .field,
  .add-site {
    display: grid;
    gap: var(--space-1);
  }

  .eyebrow {
    color: var(--accent-strong);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    font-size: 22px;
    line-height: 1.3;
  }

  h2 {
    margin-bottom: var(--space-3);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .help {
    margin-bottom: var(--space-3);
  }

  h3 {
    margin: var(--space-4) 0 var(--space-2);
    font-size: 12px;
    font-weight: 700;
  }

  h4 {
    margin: 0 0 var(--space-1);
    font-size: 13px;
    font-weight: 700;
  }

  .terms {
    display: grid;
    gap: var(--space-3);
  }

  .terms .conditions {
    display: grid;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding-left: 18px;
    list-style: disc;
  }

  .more {
    margin-top: var(--space-3);
  }

  .more > summary {
    cursor: pointer;
    color: var(--accent-strong);
    font-weight: 600;
  }

  .more .links {
    margin-top: var(--space-2);
  }

  .diag {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .diag div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .diag dt {
    color: var(--muted);
  }

  .diag dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .sites {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .sites li {
    display: grid;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .site-host {
    font-weight: 700;
  }

  .site-controls {
    display: grid;
    gap: var(--space-2);
  }

  .site-remove {
    justify-self: start;
  }

  .add-site {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .add-site {
    align-items: end;
    margin-top: var(--space-3);
  }

  .add-site label,
  .field {
    display: grid;
    flex: 1;
    gap: var(--space-1);
  }

  .field > span,
  .add-site span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  select,
  input {
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }

  .links {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  .cache-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }

  .cache-row p {
    margin: 0;
  }

  .footer {
    display: grid;
    gap: var(--space-1);
  }

  .panel-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    cursor: pointer;
    user-select: none;
  }

  .panel-summary h2 {
    margin: 0;
  }

  .collapsible-body {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .count-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .diag-details > .diag {
    margin-top: var(--space-2);
  }
</style>
