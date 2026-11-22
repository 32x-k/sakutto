<script lang="ts">
  import {
    testLocalServer,
    type ConnectionTestProgress,
    type LocalServerModel,
  } from '@/engine/local-server/client';
  import { requestServerPermission } from '@/engine/local-server/permissions';
  import {
    FASTFLOWLM_PLAMO_MODELS,
    isFastFlowLmUrl,
    isRemoteServerUrl,
    LOCAL_SERVER_PRESETS,
    serverOriginKey,
    sortLocalServerModels,
  } from '@/engine/local-server/url';
  import { EngineError } from '@/engine/errors';
  import { currentUiLanguage, t } from '@/shared/i18n';
  import { PROJECT_LINKS } from '@/shared/plamo-license';
  import type { Settings, SettingsPatch } from '@/shared/settings';

  interface Props {
    settings: Settings;
    onUpdate: (patch: SettingsPatch) => Promise<void>;
  }

  let { settings, onUpdate }: Props = $props();

  let models = $state<LocalServerModel[]>([]);
  let testing = $state(false);
  let testError = $state<EngineError | null>(null);
  let testOk = $state(false);
  let testProgress = $state<ConnectionTestProgress | null>(null);
  let testProbeText = $state('');
  let testElapsedMs = $state<number | null>(null);
  let testFirstTokenMs = $state<number | null>(null);
  let liveElapsedMs = $state(0);
  let permissionDenied = $state(false);
  let remote = $derived(isRemoteServerUrl(settings.localServerUrl));
  let isFastFlowLm = $derived(isFastFlowLmUrl(settings.localServerUrl));
  let isJa = $derived(currentUiLanguage().toLowerCase().startsWith('ja'));

  function formatSeconds(ms: number): string {
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function progressLabel(progress: ConnectionTestProgress | null, elapsedMs: number): string {
    const sec = formatSeconds(Math.max(elapsedMs, progress?.elapsedMs ?? 0));
    if (!progress || progress.stage === 'models') {
      return isJa
        ? `サーバーのモデル一覧を確認中 (/v1/models)… (${sec})`
        : `Checking server models (/v1/models)… (${sec})`;
    }
    const modelTag = progress.model ? ` [${progress.model}]` : '';
    if (progress.stage === 'loading-model') {
      return isJa
        ? `モデル準備・テスト翻訳を実行中${modelTag} ("Hi." → …) (${sec})`
        : `Loading model & running test translation${modelTag} ("Hi." → …) (${sec})`;
    }
    if (progress.stage === 'streaming') {
      const sample = progress.probeText ? ` "${progress.probeText}"` : '';
      return isJa
        ? `応答を受信中${modelTag}:${sample} (${sec})`
        : `Receiving response${modelTag}:${sample} (${sec})`;
    }
    return `${t('statusChecking')} (${sec})`;
  }

  async function grantIfNeeded(url: string): Promise<boolean> {
    const granted = await requestServerPermission(url);
    if (!granted) {
      permissionDenied = true;
      return false;
    }
    permissionDenied = false;
    return true;
  }

  async function changeUrl(event: Event) {
    const url = (event.currentTarget as HTMLInputElement).value;
    testOk = false;
    testError = null;
    const originChanged = serverOriginKey(url) !== serverOriginKey(settings.localServerUrl);
    const remoteNext = isRemoteServerUrl(url);
    const patch: SettingsPatch = {
      engineSource: 'local-server',
      localServerExperimentalAck: true,
      localServerUrl: url,
    };
    if (originChanged) patch.localServerAllowRemote = false;

    if (remoteNext) {
      permissionDenied = false;
      await onUpdate(patch);
      return;
    }

    if (!(await grantIfNeeded(url))) return;
    permissionDenied = false;
    await onUpdate(patch);
  }

  async function applyPreset(id: keyof typeof LOCAL_SERVER_PRESETS) {
    const preset = LOCAL_SERVER_PRESETS[id];
    const url = preset.url;
    testOk = false;
    testError = null;
    const originChanged = serverOriginKey(url) !== serverOriginKey(settings.localServerUrl);
    const remoteNext = isRemoteServerUrl(url);
    const patch: SettingsPatch = {
      engineSource: 'local-server',
      localServerExperimentalAck: true,
      localServerUrl: url,
    };
    if ('model' in preset && preset.model) patch.localServerModel = preset.model;
    if ('parallel' in preset && typeof preset.parallel === 'number') {
      patch.localServerParallel = preset.parallel;
    }
    if (originChanged) patch.localServerAllowRemote = false;
    if (!remoteNext) {
      if (!(await grantIfNeeded(url))) return;
    }
    permissionDenied = false;
    await onUpdate(patch);
  }

  async function changeModel(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    await onUpdate({
      engineSource: 'local-server',
      localServerExperimentalAck: true,
      localServerModel: target.value,
    });
  }

  async function selectQuickModel(modelId: string) {
    testOk = false;
    testError = null;
    await onUpdate({
      engineSource: 'local-server',
      localServerExperimentalAck: true,
      localServerModel: modelId,
    });
  }

  async function changeApiKey(event: Event) {
    await onUpdate({ localServerApiKey: (event.currentTarget as HTMLInputElement).value });
  }

  async function changeTimeout(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    await onUpdate({ localServerTimeoutMs: value * 1000 });
  }

  async function changeParallel(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    await onUpdate({ localServerParallel: value });
  }

  async function changeAllowRemote(event: Event) {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    testOk = false;
    testError = null;
    if (checked) {
      if (!(await grantIfNeeded(settings.localServerUrl))) return;
    }
    permissionDenied = false;
    await onUpdate({ localServerAllowRemote: checked });
  }

  function testMessage(error: EngineError | null): string {
    if (!error) {
      return models.length > 0 ? t('localServerTestOk') : t('localServerTestOkUnlisted');
    }
    if (error.code === 'server-remote-unconfirmed') return t('localServerRemoteConfirmRequired');
    if (error.code === 'server-unavailable') return t('localServerUnreachable');
    if (error.code === 'server-timeout') return t('localServerTimeout');
    if (error.code === 'server-model-missing') return t('localServerModelMissing');
    return t('localServerTestFail');
  }

  async function runTest() {
    testing = true;
    testOk = false;
    testError = null;
    testProgress = { stage: 'models', elapsedMs: 0 };
    testProbeText = '';
    testElapsedMs = null;
    testFirstTokenMs = null;
    liveElapsedMs = 0;
    permissionDenied = false;
    if (isRemoteServerUrl(settings.localServerUrl) && !settings.localServerAllowRemote) {
      testError = new EngineError(
        'server-remote-unconfirmed',
        'The local server URL is not on this machine. Confirm the warning in Settings to send text there.',
      );
      testing = false;
      return;
    }
    if (!(await grantIfNeeded(settings.localServerUrl))) {
      testing = false;
      return;
    }
    if (settings.engineSource !== 'local-server' || !settings.localServerExperimentalAck) {
      await onUpdate({ engineSource: 'local-server', localServerExperimentalAck: true });
    }
    const startedAt = performance.now();
    const timer = setInterval(() => {
      liveElapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
    }, 150);
    try {
      const result = await testLocalServer(
        {
          baseUrl: settings.localServerUrl,
          model: settings.localServerModel,
          apiKey: settings.localServerApiKey,
          timeoutMs: settings.localServerTimeoutMs,
          allowRemote: settings.localServerAllowRemote,
          parallel: settings.localServerParallel,
        },
        fetch,
        (progress) => {
          testProgress = progress;
          if (progress.probeText !== undefined) testProbeText = progress.probeText;
        },
      );
      const sortedModels = sortLocalServerModels(result.models);
      models = sortedModels;
      testOk = result.ok;
      testError = result.error ?? null;
      testProbeText = result.probeText ?? testProbeText;
      testElapsedMs = result.elapsedMs ?? Math.max(0, Math.round(performance.now() - startedAt));
      testFirstTokenMs = result.firstTokenMs ?? null;
      if (result.ok && settings.localServerModel.length === 0 && sortedModels[0]) {
        await onUpdate({ localServerModel: sortedModels[0].id });
      }
    } finally {
      clearInterval(timer);
      testing = false;
    }
  }
</script>

<div class="engine-choice">
  <div class="card">
    <p class="help">
      {t('localServerHelp')}
      <a href={PROJECT_LINKS.localServerDocs} target="_blank" rel="noreferrer">
        {t('localServerDetails')}
      </a>
    </p>

    <div class="presets">
      <button class="button secondary" type="button" onclick={() => void applyPreset('mlx')}>
        {t('localServerPresetMlx')}
      </button>
      <button class="button secondary" type="button" onclick={() => void applyPreset('lm-studio')}>
        {t('localServerPresetLmStudio')}
      </button>
      <button
        class="button secondary"
        type="button"
        onclick={() => void applyPreset('fastflowlm-npu')}
      >
        {t('localServerPresetFastFlowLM')}
      </button>
    </div>
    <p class="help">{t('localServerPresetHelp')}</p>

    <label class="field">
      <span>{t('localServerUrlLabel')}</span>
      <input
        type="url"
        value={settings.localServerUrl}
        onchange={changeUrl}
        autocomplete="off"
        spellcheck="false"
        aria-describedby="local-server-url-help"
      />
    </label>
    <p class="help" id="local-server-url-help">{t('localServerUrlHelp')}</p>

    {#if remote}
      <label class="check">
        <input
          type="checkbox"
          checked={settings.localServerAllowRemote}
          onchange={changeAllowRemote}
        />
        <span>{t('localServerNonLocalWarning')}</span>
      </label>
    {/if}

    <label class="field">
      <span>{t('localServerModelLabel')}</span>
      <input
        type="text"
        list="sakutto-local-server-models"
        value={settings.localServerModel}
        onchange={changeModel}
        autocomplete="off"
        spellcheck="false"
        aria-describedby="local-server-model-help"
      />
      <datalist id="sakutto-local-server-models">
        {#each models as model (model.id)}
          <option value={model.id}>{model.id}</option>
        {/each}
      </datalist>
    </label>
    <p class="help" id="local-server-model-help">{t('localServerModelHelp')}</p>
    {#if isFastFlowLm}
      <div class="presets">
        {#each FASTFLOWLM_PLAMO_MODELS as modelId (modelId)}
          <button
            class="button"
            class:secondary={settings.localServerModel !== modelId}
            type="button"
            aria-pressed={settings.localServerModel === modelId}
            onclick={() => void selectQuickModel(modelId)}
          >
            {modelId}
          </button>
        {/each}
      </div>
    {/if}

    <details class="advanced">
      <summary>{t('localServerAdvanced')}</summary>
      <label class="field">
        <span>{t('localServerApiKeyLabel')}</span>
        <input
          type="password"
          value={settings.localServerApiKey}
          onchange={changeApiKey}
          autocomplete="off"
        />
      </label>
      <label class="field">
        <span>{t('localServerTimeoutLabel')}</span>
        <input
          type="number"
          min="5"
          max="600"
          step="5"
          value={Math.round(settings.localServerTimeoutMs / 1000)}
          onchange={changeTimeout}
        />
      </label>
      <label class="field">
        <span>{t('localServerParallelLabel')}</span>
        <input
          type="number"
          min="1"
          max="16"
          step="1"
          value={settings.localServerParallel}
          onchange={changeParallel}
        />
      </label>
      <p class="help">{t('localServerParallelHelp')}</p>
    </details>

    <div class="test-row">
      <button
        class="button secondary"
        type="button"
        onclick={() => void runTest()}
        disabled={testing}
      >
        {testing ? t('statusChecking') : t('localServerTestButton')}
      </button>
      {#if permissionDenied}
        <span class="chip bad" role="alert">{t('localServerPermissionDenied')}</span>
      {:else if testOk}
        <span class="chip ok" role="status">{t('localServerTestOk')}</span>
      {:else if testError}
        <span class="chip bad" role="alert">{t('localServerTestFail')}</span>
      {/if}
    </div>
    {#if testing}
      <div class="test-status-box" role="status">
        <p class="test-status-line">{progressLabel(testProgress, liveElapsedMs)}</p>
      </div>
    {:else if testOk}
      <div class="test-status-box" role="status">
        {#if models.length === 0}
          <p class="help">{t('localServerTestOkUnlisted')}</p>
        {/if}
        <dl class="test-meta">
          <div>
            <dt>{isJa ? '対象モデル' : 'Model'}</dt>
            <dd>
              {settings.localServerModel ||
                models[0]?.id ||
                (isJa ? '(サーバー既定)' : '(server default)')}
              {#if models.length > 0}
                <span class="meta-sub"
                  >({isJa ? `${models.length}件検出` : `${models.length} listed`})</span
                >
              {/if}
            </dd>
          </div>
          {#if testProbeText}
            <div>
              <dt>{isJa ? 'テスト応答' : 'Probe output'}</dt>
              <dd><code>"Hi." → "{testProbeText}"</code></dd>
            </div>
          {/if}
          {#if testElapsedMs !== null}
            <div>
              <dt>{isJa ? '応答時間' : 'Latency'}</dt>
              <dd>
                {#if testFirstTokenMs !== null && testFirstTokenMs < testElapsedMs}
                  {isJa
                    ? `初回トークン ${formatSeconds(testFirstTokenMs)} / 合計 ${formatSeconds(testElapsedMs)}`
                    : `TTFT ${formatSeconds(testFirstTokenMs)} / Total ${formatSeconds(testElapsedMs)}`}
                {:else}
                  {formatSeconds(testElapsedMs)}
                {/if}
              </dd>
            </div>
          {/if}
        </dl>
      </div>
    {:else if testError}
      <div class="test-status-box error-box" role="alert">
        <p class="error">{testMessage(testError)}</p>
        {#if testError.detail}
          <p class="help"><code>{testError.detail}</code></p>
        {/if}
      </div>
    {/if}
    <p class="help">{t('localServerLicenseNote')}</p>
  </div>
</div>

<style>
  .engine-choice,
  .card,
  .field {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .card {
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
  }

  .help {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    font-weight: 400;
    line-height: 1.5;
  }

  .presets,
  .test-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .field > span:first-child {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }

  .field input {
    width: 100%;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    font-size: 13px;
    line-height: 1.45;
  }

  .check input {
    width: auto;
    margin-top: 3px;
  }

  .advanced {
    display: grid;
    gap: var(--space-3);
  }

  .advanced summary {
    cursor: pointer;
    color: var(--accent-strong);
    font-weight: 600;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.4;
  }

  .chip.ok {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface));
    color: var(--accent-strong);
  }

  .chip.bad {
    background: color-mix(in srgb, var(--danger) 18%, var(--surface));
    color: var(--danger);
  }

  .test-status-box {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-size: 12px;
  }

  .test-status-box.error-box {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
  }

  .test-status-line {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .test-meta {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }

  .test-meta div {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .test-meta dt {
    color: var(--muted);
    font-weight: 600;
  }

  .test-meta dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .meta-sub {
    color: var(--muted);
    font-size: 11px;
  }

  .error {
    margin: 0;
  }
</style>
