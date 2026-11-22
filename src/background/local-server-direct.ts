import { CachingEngine, type CacheAccept } from '@/engine/cache/caching-engine';
import { TranslationCache } from '@/engine/cache/cache';
import { IndexedDbTranslationCacheStore, MemoryTranslationCacheStore } from '@/engine/cache/store';
import { getModel, type ModelId } from '@/engine/model/catalog';
import { normalizeSelectedModelId } from '@/engine/model/selection';
import { InBrowserEngine } from '@/engine/in-browser/engine';
import { JobScheduler } from '@/engine/queue/scheduler';
import { LocalServerRuntime } from '@/engine/local-server/runtime';
import {
  localServerConfigFromSettings,
  type LocalServerConfig,
} from '@/engine/local-server/client';
import { RoutingEngine } from '@/engine/router';
import { translationStaysInSourceLanguage } from '@/pdf/language';
import type { EngineStatus, ModelStatus } from '@/shared/engine-status';
import { canonicalLanguage, isPlamoOnlyTarget } from '@/shared/languages';
import type { Settings } from '@/shared/settings';
import type { TranslateOptions, TranslateSegment, TranslationChunk } from '@/engine/types';

async function openCache(): Promise<TranslationCache> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return new TranslationCache(await IndexedDbTranslationCacheStore.open());
  } catch {
    return new TranslationCache(new MemoryTranslationCacheStore());
  }
}

const acceptCachedTranslation: CacheAccept = (text, source, options) =>
  !translationStaysInSourceLanguage(source, text, options.tgt);

function plamoSupports(src: string | undefined, tgt: string): boolean {
  return (
    (canonicalLanguage(tgt) !== null || isPlamoOnlyTarget(tgt)) &&
    (src === undefined || src.trim().length === 0 || canonicalLanguage(src) !== null)
  );
}

/**
 * Runs `local-server` translations directly inside the Firefox background event page,
 * avoiding a hidden `offscreen.html` iframe, extra JS heap, port hop, and keep-alive timer.
 */
export class DirectLocalServerEngine {
  config: LocalServerConfig;
  selectedModelId: ModelId;
  readonly runtime: LocalServerRuntime;
  readonly scheduler: JobScheduler;
  readonly inBrowser: InBrowserEngine;
  private cacheTask: Promise<TranslationCache> | null = null;
  private routerTask: Promise<RoutingEngine> | null = null;
  private router: RoutingEngine | null = null;

  constructor(settings: Settings) {
    this.config = localServerConfigFromSettings(settings);
    this.selectedModelId = normalizeSelectedModelId(settings.selectedModelId);
    this.runtime = new LocalServerRuntime(() => this.config);
    this.scheduler = new JobScheduler(this.config.parallel, 'pool');
    this.inBrowser = new InBrowserEngine(this.runtime, { scheduler: this.scheduler });
  }

  applySettings(settings: Settings): void {
    this.config = localServerConfigFromSettings(settings);
    this.selectedModelId = normalizeSelectedModelId(settings.selectedModelId);
    this.scheduler.setConcurrency(this.config.parallel);
  }

  private getCache(): Promise<TranslationCache> {
    this.cacheTask ??= openCache();
    return this.cacheTask;
  }

  private getRouter(): Promise<RoutingEngine> {
    this.routerTask ??= this.getCache().then((cache) => {
      const plamo = new CachingEngine(
        this.inBrowser,
        cache,
        () => `local:${this.config.model.length > 0 ? this.config.model : 'default'}`,
        'local-server',
        acceptCachedTranslation,
      );
      const router = new RoutingEngine({
        plamo,
        chrome: null,
        plamoSupports,
        chromeSupport: async () => 'unavailable',
      });
      this.router = router;
      return router;
    });
    return this.routerTask;
  }

  private model(): ModelStatus {
    return {
      id: this.selectedModelId,
      state: 'absent',
      received: 0,
      total: getModel(this.selectedModelId).size,
      progress: 0,
    };
  }

  status(): EngineStatus {
    return {
      model: this.model(),
      backend: 'local-server',
      engineSource: 'local-server',
      tier: null,
      threads: 1,
      parallel: this.config.parallel,
      plamoReady: true,
      chromeSupported: false,
      active: this.router?.activeEngine ?? null,
    };
  }

  warmModel(): ModelStatus {
    return this.model();
  }

  async clearCache(): Promise<void> {
    await (await this.getCache()).clear();
  }

  async *translate(
    segments: readonly TranslateSegment[],
    options: TranslateOptions,
  ): AsyncGenerator<TranslationChunk> {
    if (segments.length === 0 || options.signal.aborted) return;
    const router = await this.getRouter();
    if (options.signal.aborted) return;
    yield* router.translate(segments, options);
  }
}
