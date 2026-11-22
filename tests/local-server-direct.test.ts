import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { EngineClient } from '@/background/engine-client';
import type { OffscreenController } from '@/background/offscreen-lifecycle';
import type { TranslateOptions, TranslationChunk } from '@/engine/types';
import { normalizeSettings, SETTINGS_SCHEMA_VERSION, type Settings } from '@/shared/settings';
import { loadSettings } from '@/shared/storage';
import { FakePort, flushTasks } from './support/ports';

vi.mock('wxt/browser', () => ({
  browser: { runtime: { id: 'test-extension', connect: vi.fn() } },
}));

vi.mock('@/shared/storage', () => ({
  loadSettings: vi.fn(),
  saveSettings: vi.fn(async () => undefined),
}));

const loadSettingsMock = vi.mocked(loadSettings);
const connectMock = vi.mocked(browser.runtime.connect);

function localSettings(overrides: Partial<Settings> = {}): Settings {
  return normalizeSettings(
    {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      targetLanguage: 'ja',
      engineSource: 'local-server',
      localServerUrl: 'http://127.0.0.1:52625/v1',
      localServerModel: 'plamo-3-translate-0.8b',
      localServerParallel: 4,
      ...overrides,
    },
    'ja',
  );
}

function inBrowserSettings(): Settings {
  return normalizeSettings(
    {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      targetLanguage: 'ja',
      engineSource: 'in-browser',
    },
    'ja',
  );
}

function offscreenController(): OffscreenController {
  return {
    ensure: vi.fn(async () => undefined),
    recreate: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as OffscreenController;
}

function sseResponse(deltas: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const text of deltas) {
        const chunk = JSON.stringify({ choices: [{ text, finish_reason: null }] });
        controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      }
      const stop = JSON.stringify({ choices: [{ text: '', finish_reason: 'stop' }] });
      controller.enqueue(encoder.encode(`data: ${stop}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function translateOptions(signal = new AbortController().signal, tgt = 'ja'): TranslateOptions {
  return { tgt, form: 'polite', priority: 10, signal };
}

afterEach(() => {
  vi.restoreAllMocks();
  loadSettingsMock.mockReset();
  connectMock.mockReset();
});

describe('DirectLocalServerEngine via EngineClient', () => {
  it('streams translations, caches hits, and invalidates via clearCache without opening offscreen', async () => {
    const settings = localSettings();
    loadSettingsMock.mockResolvedValue(settings);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => sseResponse(['こん', 'にちは。']));

    const offscreen = offscreenController();
    const client = new EngineClient(offscreen, { directLocalServer: true });

    const first: TranslationChunk[] = [];
    for await (const chunk of client.translate([{ id: '1', text: 'Hello.' }], translateOptions())) {
      first.push(chunk);
    }

    expect(first.some((chunk) => chunk.textDelta === 'こん')).toBe(true);
    expect(first.at(-1)).toMatchObject({ id: '1', final: 'こんにちは。', engine: 'plamo' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await client.status()).active).toBe('plamo');

    // Second identical request should be served from cache with no extra fetch.
    const cached: TranslationChunk[] = [];
    for await (const chunk of client.translate([{ id: '1', text: 'Hello.' }], translateOptions())) {
      cached.push(chunk);
    }
    expect(cached.at(-1)).toMatchObject({ id: '1', final: 'こんにちは。', engine: 'plamo' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Clearing cache forces a fresh server call.
    await client.clearCache();
    const afterClear: TranslationChunk[] = [];
    for await (const chunk of client.translate([{ id: '1', text: 'Hello.' }], translateOptions())) {
      afterClear.push(chunk);
    }
    expect(afterClear.at(-1)).toMatchObject({ id: '1', final: 'こんにちは。', engine: 'plamo' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    expect(offscreen.ensure).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('cancels cleanly when aborted without throwing or opening offscreen', async () => {
    loadSettingsMock.mockResolvedValue(localSettings());
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    const offscreen = offscreenController();
    const client = new EngineClient(offscreen, { directLocalServer: true });
    const abort = new AbortController();

    const chunks: TranslationChunk[] = [];
    const run = (async () => {
      for await (const chunk of client.translate(
        [{ id: 'a', text: 'Wait for cancellation.' }],
        translateOptions(abort.signal),
      )) {
        chunks.push(chunk);
      }
    })();

    await vi.waitFor(() => {
      expect(observedSignal).toBeDefined();
    });
    abort.abort();
    await run;

    expect(observedSignal?.aborted).toBe(true);
    expect(chunks).toEqual([]);
    expect(offscreen.ensure).not.toHaveBeenCalled();
  });

  it('rejects unsupported language pairs consistently with EngineHost', async () => {
    loadSettingsMock.mockResolvedValue(localSettings());
    const offscreen = offscreenController();
    const client = new EngineClient(offscreen, { directLocalServer: true });

    const run = (async () => {
      for await (const chunk of client.translate(
        [{ id: 'a', text: 'Hello.' }],
        translateOptions(new AbortController().signal, 'pt'),
      )) {
        void chunk;
      }
    })();

    await expect(run).rejects.toMatchObject({ code: 'unsupported-language' });
    expect(offscreen.ensure).not.toHaveBeenCalled();
  });

  it('updates concurrency via syncStoredSettings and handles bootSource without reopening offscreen', async () => {
    const initial = localSettings({ localServerParallel: 2 });
    loadSettingsMock.mockResolvedValue(initial);
    const offscreen = offscreenController();
    const client = new EngineClient(offscreen, { directLocalServer: true });

    await client.bootSource();
    expect(offscreen.close).toHaveBeenCalledTimes(1);
    expect(offscreen.ensure).not.toHaveBeenCalled();
    expect((await client.status()).parallel).toBe(2);

    const updated = localSettings({ localServerParallel: 6 });
    loadSettingsMock.mockResolvedValue(updated);
    client.syncStoredSettings(updated);
    expect((await client.status()).parallel).toBe(6);
    expect(offscreen.ensure).not.toHaveBeenCalled();
  });

  it('closes an open offscreen host when switching from in-browser to local-server and reopens when switching back', async () => {
    const browserSettings = inBrowserSettings();
    loadSettingsMock.mockResolvedValue(browserSettings);
    const port = new FakePort();
    connectMock.mockReturnValue(port.port);

    const offscreen = offscreenController();
    const client = new EngineClient(offscreen, { directLocalServer: true });

    const setInBrowser = client.setSource(browserSettings);
    for (const type of ['source-set', 'runtime-set', 'model-set']) {
      let msg: { requestId: string } | undefined;
      for (let i = 0; i < 20 && !msg; i += 1) {
        msg = port.messagesOfType(type)[0] as { requestId: string } | undefined;
        if (!msg) await flushTasks();
      }
      if (!msg) throw new Error(`Missing ${type}`);
      port.emit({ type: 'response', requestId: msg.requestId, ok: true, value: null });
    }
    await setInBrowser;
    expect(offscreen.ensure).toHaveBeenCalledTimes(1);

    // Switch to local-server -> drops port and closes offscreen host.
    const local = localSettings();
    loadSettingsMock.mockResolvedValue(local);
    await client.setSource(local);
    expect(offscreen.close).toHaveBeenCalledTimes(1);
    expect(await client.status()).toMatchObject({
      engineSource: 'local-server',
      backend: 'local-server',
    });
    expect(offscreen.ensure).toHaveBeenCalledTimes(1);

    // Switch back to in-browser -> opens offscreen host again cleanly.
    const port2 = new FakePort();
    connectMock.mockReturnValue(port2.port);
    loadSettingsMock.mockResolvedValue(browserSettings);
    const back = client.setSource(browserSettings);
    for (const type of ['source-set', 'runtime-set', 'model-set']) {
      let msg: { requestId: string } | undefined;
      for (let i = 0; i < 20 && !msg; i += 1) {
        msg = port2.messagesOfType(type)[0] as { requestId: string } | undefined;
        if (!msg) await flushTasks();
      }
      if (!msg) throw new Error(`Missing ${type}`);
      port2.emit({ type: 'response', requestId: msg.requestId, ok: true, value: null });
    }
    await back;
    expect(offscreen.ensure).toHaveBeenCalledTimes(2);
  });
});
