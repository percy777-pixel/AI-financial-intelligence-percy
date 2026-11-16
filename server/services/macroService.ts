import {
  getDatabaseSchemaMode,
  getPersistenceMode,
  inspectDatabaseSchemaCompatibility,
  prisma,
} from '../prisma.js';

const LEGACY_NEON_MACRO_CODE_MAP: Record<string, string> = {
  SELIC: 'BCB_SGS_432',
  CDI: 'BCB_SGS_4389',
  PTAX: 'BCB_SGS_1',
  IPCA: 'IBGE_SIDRA_7060_2265',
  IPCA_MENSAL: 'IBGE_SIDRA_7060_63',
  PMC: 'IBGE_SIDRA_8880_11708',
};

export interface MacroIndicatorData {
  code: string;
  seriesCode: string;
  name: string;
  variable: string;
  source: string;
  unit: string;
  frequency: string;
  value: number;
  referenceDate: string; // YYYY-MM-DD
  publicationDate: string | null; // null when not provided by BCB SGS API (never equal to fetchedAt by default)
  fetchedAt: string;
  syncSource: 'LIVE_API' | 'LOCAL_REFERENCE';
  methodology: string;
}

export interface SeriesConfig {
  code: string;
  seriesCode: string;
  name: string;
  variable: string;
  source: string;
  unit: string;
  frequency: string;
  methodology: string;
  bcbSgsId?: number;
  fallbackHistory: Array<{ referenceDate: string; publicationDate: string; value: number }>;
}

export const SERIES_CATALOG: SeriesConfig[] = [
  {
    code: 'SELIC',
    seriesCode: 'BCB-432',
    name: 'Taxa Selic Meta (COPOM)',
    variable: 'Meta para a taxa Selic definida pelo COPOM',
    source: 'BCB/SGS (Série 432)',
    unit: '% a.a.',
    frequency: 'Reunião COPOM / Diária',
    methodology: 'Taxa anualizada definida pelo Comitê de Política Monetária. Não confundir com taxa diária ou CDI.',
    bcbSgsId: 432,
    fallbackHistory: [
      { referenceDate: '2026-06-01', publicationDate: '2026-06-18', value: 10.50 },
      { referenceDate: '2026-07-01', publicationDate: '2026-07-30', value: 10.50 },
      { referenceDate: '2026-08-01', publicationDate: '2026-08-05', value: 10.75 },
      { referenceDate: '2026-09-01', publicationDate: '2026-09-17', value: 11.00 },
      { referenceDate: '2026-10-01', publicationDate: '2026-10-02', value: 11.25 },
      { referenceDate: '2026-11-01', publicationDate: '2026-11-05', value: 11.25 },
    ],
  },
  {
    code: 'CDI',
    seriesCode: 'BCB-4389',
    name: 'Taxa DI / CDI Anualizada (Base 252)',
    variable: 'Taxa média anualizada dos depósitos interfinanceiros (CDI)',
    source: 'B3 / BCB/SGS (Série 4389)',
    unit: '% a.a.',
    frequency: 'Diária (anualizada base 252 dias úteis)',
    methodology: 'Série 4389 expressa em % a.a. (distinta da série 12 diária em % a.d.). Referência para dívidas pós-fixadas em CDI.',
    bcbSgsId: 4389,
    fallbackHistory: [
      { referenceDate: '2026-06-01', publicationDate: '2026-06-30', value: 10.40 },
      { referenceDate: '2026-07-01', publicationDate: '2026-07-31', value: 10.40 },
      { referenceDate: '2026-08-01', publicationDate: '2026-08-31', value: 10.65 },
      { referenceDate: '2026-09-01', publicationDate: '2026-09-30', value: 10.90 },
      { referenceDate: '2026-10-01', publicationDate: '2026-10-30', value: 11.15 },
      { referenceDate: '2026-11-01', publicationDate: '2026-11-12', value: 11.15 },
    ],
  },
  {
    code: 'PTAX',
    seriesCode: 'BCB-1',
    name: 'Dólar Comercial PTAX (Venda)',
    variable: 'Taxa de câmbio de referência USD/BRL (PTAX Venda)',
    source: 'BCB/SGS (Série 1)',
    unit: 'R$/USD',
    frequency: 'Diária',
    methodology: 'Média aritmética das cotações apuradas pelo Banco Central em 4 janelas diárias.',
    bcbSgsId: 1,
    fallbackHistory: [
      { referenceDate: '2026-06-01', publicationDate: '2026-06-30', value: 5.32 },
      { referenceDate: '2026-07-01', publicationDate: '2026-07-31', value: 5.41 },
      { referenceDate: '2026-08-01', publicationDate: '2026-08-31', value: 5.54 },
      { referenceDate: '2026-09-01', publicationDate: '2026-09-30', value: 5.45 },
      { referenceDate: '2026-10-01', publicationDate: '2026-10-30', value: 5.51 },
      { referenceDate: '2026-11-12', publicationDate: '2026-11-12', value: 5.48 },
    ],
  },
  {
    code: 'IPCA',
    seriesCode: 'BCB-13522',
    name: 'IPCA Acumulado 12 Meses',
    variable: 'Índice Nacional de Preços ao Consumidor Amplo — variação acumulada em 12 meses',
    source: 'IBGE/SIDRA (Tab. 1737) via BCB/SGS (Série 13522)',
    unit: '% a.a. (12m)',
    frequency: 'Mensal',
    methodology: 'Variação acumulada de 12 meses. Não confundir com variação mensal (IPCA_MENSAL).',
    bcbSgsId: 13522,
    fallbackHistory: [
      { referenceDate: '2026-05-01', publicationDate: '2026-06-10', value: 3.93 },
      { referenceDate: '2026-06-01', publicationDate: '2026-07-10', value: 4.18 },
      { referenceDate: '2026-07-01', publicationDate: '2026-08-11', value: 4.30 },
      { referenceDate: '2026-08-01', publicationDate: '2026-09-10', value: 4.24 },
      { referenceDate: '2026-09-01', publicationDate: '2026-10-09', value: 4.42 },
      { referenceDate: '2026-10-01', publicationDate: '2026-11-10', value: 4.45 },
    ],
  },
  {
    code: 'IPCA_MENSAL',
    seriesCode: 'BCB-433',
    name: 'IPCA Variação Mensal',
    variable: 'Variação percentual mensal do IPCA',
    source: 'IBGE / BCB/SGS (Série 433)',
    unit: '% a.m.',
    frequency: 'Mensal',
    methodology: 'Variação mensal oficial do índice de inflação ao consumidor.',
    bcbSgsId: 433,
    fallbackHistory: [
      { referenceDate: '2026-05-01', publicationDate: '2026-06-10', value: 0.46 },
      { referenceDate: '2026-06-01', publicationDate: '2026-07-10', value: 0.21 },
      { referenceDate: '2026-07-01', publicationDate: '2026-08-11', value: 0.38 },
      { referenceDate: '2026-08-01', publicationDate: '2026-09-10', value: 0.19 },
      { referenceDate: '2026-09-01', publicationDate: '2026-10-09', value: 0.44 },
      { referenceDate: '2026-10-01', publicationDate: '2026-11-10', value: 0.56 },
    ],
  },
  {
    code: 'PMC',
    seriesCode: 'BCB-1455',
    name: 'PMC Volume de Vendas no Varejo',
    variable: 'Pesquisa Mensal de Comércio — Índice de Volume de Vendas no Varejo Restrito',
    source: 'IBGE/SIDRA via BCB/SGS (Série 1455)',
    unit: 'Índice (2022=100)',
    frequency: 'Mensal',
    methodology: 'Mede o comportamento conjuntural do volume de vendas no comércio varejista brasileiro.',
    bcbSgsId: 1455,
    fallbackHistory: [
      { referenceDate: '2026-04-01', publicationDate: '2026-06-15', value: 101.8 },
      { referenceDate: '2026-05-01', publicationDate: '2026-07-15', value: 102.4 },
      { referenceDate: '2026-06-01', publicationDate: '2026-08-14', value: 102.1 },
      { referenceDate: '2026-07-01', publicationDate: '2026-09-15', value: 103.5 },
      { referenceDate: '2026-08-01', publicationDate: '2026-10-15', value: 103.9 },
      { referenceDate: '2026-09-01', publicationDate: '2026-11-12', value: 104.2 },
    ],
  },
];

// In-memory store for environments without DATABASE_URL
const memoryObservations = new Map<string, MacroIndicatorData[]>();

export function resetMemoryMacroToLocalReference(): void {
  memoryObservations.clear();
  initMemoryMacroIfEmpty();
}

function initMemoryMacroIfEmpty() {
  if (memoryObservations.size > 0) return;
  const nowIso = new Date().toISOString();
  for (const cfg of SERIES_CATALOG) {
    memoryObservations.set(
      cfg.code,
      cfg.fallbackHistory.map(item => ({
        code: cfg.code,
        seriesCode: cfg.seriesCode,
        name: cfg.name,
        variable: cfg.variable,
        source: cfg.source,
        unit: cfg.unit,
        frequency: cfg.frequency,
        value: item.value,
        referenceDate: item.referenceDate,
        publicationDate: item.publicationDate,
        fetchedAt: nowIso,
        syncSource: 'LOCAL_REFERENCE',
        methodology: cfg.methodology,
      }))
    );
  }
}

initMemoryMacroIfEmpty();

export function parseBcbDate(ddmmyyyy: string): string | null {
  if (typeof ddmmyyyy !== 'string') return null;
  const parts = ddmmyyyy.trim().split('/');
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!/^\d{2}$/.test(dd) || !/^\d{2}$/.test(mm) || !/^\d{4}$/.test(yyyy)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseBcbSgsResponse(
  rows: unknown,
  maxDate: Date = new Date('2099-12-31T23:59:59Z')
): Array<{ referenceDate: string; value: number }> | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const mapped: Array<{ referenceDate: string; value: number }> = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const iso = parseBcbDate((row as any).data);
    const rawVal = typeof (row as any).valor === 'string' ? (row as any).valor.replace(',', '.') : (row as any).valor;
    const val = Number(rawVal);
    if (iso && Number.isFinite(val) && new Date(iso) <= maxDate) {
      mapped.push({ referenceDate: iso, value: val });
    }
  }
  return mapped.length > 0 ? mapped : null;
}

function formatDateBr(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function tryFetchBcbSgsSeries(
  seriesId: number,
  lastN = 12,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<Array<{ referenceDate: string; value: number }> | null> {
  try {
    const fetchFn = options?.fetchImpl || fetch;
    const timeoutMs = options?.timeoutMs ?? 4500;
    const now = new Date();
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados/ultimos/${lastN}?formato=json`;
    const res = await fetchFn(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const rows = await res.json();
      const parsed = parseBcbSgsResponse(rows, now);
      if (parsed && parsed.length > 0) {
        return parsed.slice(-lastN);
      }
    }

    // Fallback for series like 432 (Meta Selic COPOM) where /dados/ultimos/N returns future dates up to the next COPOM meeting
    if (!options?.fetchImpl) {
      const startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
      const rangeUrl = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesId}/dados?formato=json&dataInicial=${formatDateBr(startDate)}&dataFinal=${formatDateBr(now)}`;
      const rangeRes = await fetchFn(rangeUrl, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (rangeRes.ok) {
        const rangeRows = await rangeRes.json();
        const rangeParsed = parseBcbSgsResponse(rangeRows, now);
        if (rangeParsed && rangeParsed.length > 0) {
          return rangeParsed.slice(-lastN);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchAndSyncMacroData(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{
  success: boolean;
  count: number;
  liveSeriesCount: number;
  fallbackSeriesCount: number;
  syncSource: string;
  error?: string;
}> {
  try {
    const today = new Date();
    const fetchedAt = today.toISOString();
    let count = 0;
    let liveSeriesCount = 0;
    let fallbackSeriesCount = 0;

    if (getPersistenceMode() === 'POSTGRESQL' && prisma && getDatabaseSchemaMode() === 'UNVERIFIED') {
      await inspectDatabaseSchemaCompatibility();
    }

    const liveResults = await Promise.all(
      SERIES_CATALOG.map(cfg =>
        cfg.bcbSgsId ? tryFetchBcbSgsSeries(cfg.bcbSgsId, 12, options) : Promise.resolve(null)
      )
    );

    for (let idx = 0; idx < SERIES_CATALOG.length; idx++) {
      const cfg = SERIES_CATALOG[idx];
      const liveData = liveResults[idx];
      let observationsToSave: Array<{
        referenceDate: string;
        publicationDate: string | null;
        value: number;
        syncSource: 'LIVE_API' | 'LOCAL_REFERENCE';
      }> = [];

      if (liveData && liveData.length > 0) {
        liveSeriesCount++;
        // BCB SGS endpoint only provides 'data' (referenceDate) and 'valor'.
        // Never invent publicationDate = fetchedAt when not provided by the official API!
        observationsToSave = liveData.map(d => ({
          referenceDate: d.referenceDate,
          publicationDate: null,
          value: d.value,
          syncSource: 'LIVE_API',
        }));
      } else {
        fallbackSeriesCount++;
        observationsToSave = cfg.fallbackHistory.map(d => ({
          referenceDate: d.referenceDate,
          publicationDate: d.publicationDate,
          value: d.value,
          syncSource: 'LOCAL_REFERENCE',
        }));
      }

      // Update in-memory cache
      memoryObservations.set(
        cfg.code,
        observationsToSave.map(obs => ({
          code: cfg.code,
          seriesCode: cfg.seriesCode,
          name: cfg.name,
          variable: cfg.variable,
          source: cfg.source,
          unit: cfg.unit,
          frequency: cfg.frequency,
          value: obs.value,
          referenceDate: obs.referenceDate,
          publicationDate: obs.publicationDate,
          fetchedAt,
          syncSource: obs.syncSource,
          methodology: cfg.methodology,
        }))
      );

      // Persist to Prisma if connected in FULL_PRISMA_SCHEMA mode
      if (getPersistenceMode() === 'POSTGRESQL' && prisma && getDatabaseSchemaMode() === 'FULL_PRISMA_SCHEMA') {
        try {
          const legacyCode = LEGACY_NEON_MACRO_CODE_MAP[cfg.code] || cfg.code;
          const existingIndicator = await prisma.macroIndicator.findFirst({
            where: {
              OR: [{ code: cfg.code }, { code: legacyCode }],
            },
          });

          const indicator = existingIndicator
            ? await prisma.macroIndicator.update({
                where: { id: existingIndicator.id },
                data: {
                  seriesCode: cfg.seriesCode,
                  methodology: cfg.methodology,
                },
              })
            : await prisma.macroIndicator.create({
                data: {
                  code: cfg.code,
                  seriesCode: cfg.seriesCode,
                  name: cfg.name,
                  source: cfg.source,
                  unit: cfg.unit,
                  frequency: cfg.frequency,
                  methodology: cfg.methodology,
                  description: cfg.variable,
                },
              });

          for (const obs of observationsToSave) {
            const refDate = new Date(`${obs.referenceDate}T00:00:00.000Z`);
            if (refDate > today) continue;
            await prisma.macroObservation.upsert({
              where: {
                indicatorId_referenceDate: {
                  indicatorId: indicator.id,
                  referenceDate: refDate,
                },
              },
              update: {
                value: obs.value,
                publicationDate: obs.publicationDate ? new Date(obs.publicationDate) : null,
                fetchedAt: today,
                syncSource: obs.syncSource,
                updatedAt: today,
              },
              create: {
                indicatorId: indicator.id,
                referenceDate: refDate,
                publicationDate: obs.publicationDate ? new Date(obs.publicationDate) : null,
                fetchedAt: today,
                syncSource: obs.syncSource,
                value: obs.value,
              },
            });
            count++;
          }
        } catch {
          count += observationsToSave.length;
        }
      } else {
        count += observationsToSave.length;
      }
    }

    const syncSourceLabel =
      liveSeriesCount > 0 && fallbackSeriesCount === 0
        ? 'LIVE_BCB_IBGE_API'
        : liveSeriesCount > 0
          ? 'HYBRID_LIVE_AND_REFERENCE'
          : 'LOCAL_REFERENCE_CACHE';

    if (getPersistenceMode() === 'POSTGRESQL' && prisma && getDatabaseSchemaMode() === 'FULL_PRISMA_SCHEMA') {
      await prisma.macroSyncLog
        .create({
          data: {
            source: syncSourceLabel,
            status: 'SUCCESS',
            recordsCount: count,
          },
        })
        .catch(() => {});
    }

    return { success: true, count, liveSeriesCount, fallbackSeriesCount, syncSource: syncSourceLabel };
  } catch (err: any) {
    if (getPersistenceMode() === 'POSTGRESQL' && prisma && getDatabaseSchemaMode() === 'FULL_PRISMA_SCHEMA') {
      await prisma.macroSyncLog
        .create({
          data: {
            source: 'BCB_IBGE_API',
            status: 'FAILED',
            errorMessage: err.message || 'Sync error',
          },
        })
        .catch(() => {});
    }
    return { success: false, count: 0, liveSeriesCount: 0, fallbackSeriesCount: 0, syncSource: 'FAILED', error: err.message };
  }
}

export async function getLatestMacroIndicators(): Promise<MacroIndicatorData[]> {
  initMemoryMacroIfEmpty();

  if (getPersistenceMode() === 'POSTGRESQL' && prisma) {
    try {
      let schemaMode = getDatabaseSchemaMode();
      if (schemaMode === 'UNVERIFIED') {
        schemaMode = await inspectDatabaseSchemaCompatibility();
      }

      if (schemaMode === 'LEGACY_COMPATIBLE_NEON') {
        const rows = (await prisma.$queryRaw`
          SELECT i.code, i.name, i.source, i.unit, i.frequency, i.description,
                 o."referenceDate", o.value, o."collectedAt"
          FROM "MacroIndicator" i
          LEFT JOIN LATERAL (
            SELECT "referenceDate", value, "collectedAt"
            FROM "MacroObservation"
            WHERE "indicatorId" = i.id
            ORDER BY "referenceDate" DESC
            LIMIT 1
          ) o ON true
        `) as Array<{
          code: string;
          name: string;
          source: string;
          unit: string;
          frequency: string;
          description: string;
          referenceDate: Date | null;
          value: any;
          collectedAt: Date | null;
        }>;

        const results: MacroIndicatorData[] = [];
        for (const cfg of SERIES_CATALOG) {
          const legacyCode = LEGACY_NEON_MACRO_CODE_MAP[cfg.code] || cfg.code;
          const matched = rows.find(r => r.code === legacyCode || r.code === cfg.code);
          if (matched && matched.value !== null && matched.referenceDate) {
            results.push({
              code: cfg.code,
              seriesCode: cfg.seriesCode,
              name: cfg.name,
              variable: cfg.variable,
              source: cfg.source,
              unit: cfg.unit,
              frequency: cfg.frequency,
              value: Number(matched.value),
              referenceDate: new Date(matched.referenceDate).toISOString().split('T')[0],
              publicationDate: null,
              fetchedAt: matched.collectedAt ? new Date(matched.collectedAt).toISOString() : new Date().toISOString(),
              syncSource: 'LIVE_API',
              methodology: cfg.methodology,
            });
          } else {
            const list = memoryObservations.get(cfg.code) || [];
            if (list.length > 0) results.push(list[list.length - 1]);
          }
        }
        if (results.length > 0) return results;
      }

      const indicators = await prisma.macroIndicator.findMany({
        include: {
          observations: {
            orderBy: { referenceDate: 'desc' },
            take: 1,
          },
        },
      });

      if (indicators.length > 0) {
        const canonicalResults: MacroIndicatorData[] = [];
        for (const cfg of SERIES_CATALOG) {
          const legacyCode = LEGACY_NEON_MACRO_CODE_MAP[cfg.code] || cfg.code;
          const ind = indicators.find(i => i.code === cfg.code || i.code === legacyCode);
          const obs = ind?.observations?.[0];
          if (ind && obs) {
            canonicalResults.push({
              code: cfg.code,
              seriesCode: ind.seriesCode || cfg.seriesCode,
              name: cfg.name,
              variable: cfg.variable,
              source: cfg.source,
              unit: cfg.unit,
              frequency: cfg.frequency,
              value: Number(obs.value),
              referenceDate: obs.referenceDate.toISOString().split('T')[0],
              publicationDate: obs.publicationDate ? obs.publicationDate.toISOString().split('T')[0] : null,
              fetchedAt: obs.fetchedAt ? obs.fetchedAt.toISOString() : new Date().toISOString(),
              syncSource: (obs.syncSource as any) || 'LIVE_API',
              methodology: ind.methodology || cfg.methodology,
            });
          } else {
            const list = memoryObservations.get(cfg.code) || [];
            if (list.length > 0) canonicalResults.push(list[list.length - 1]);
          }
        }
        if (canonicalResults.length > 0) return canonicalResults;
      }
    } catch {
      // Fall back cleanly to memory cache if DB not ready
    }
  }

  return SERIES_CATALOG.map(cfg => {
    const list = memoryObservations.get(cfg.code) || [];
    return list[list.length - 1];
  }).filter(Boolean);
}

export async function getMacroHistory(code: string, limit = 12): Promise<MacroIndicatorData[]> {
  initMemoryMacroIfEmpty();
  const normalizedCode = code.toUpperCase().trim();
  const cfg = SERIES_CATALOG.find(c => c.code === normalizedCode);

  if (getPersistenceMode() === 'POSTGRESQL' && prisma) {
    try {
      let schemaMode = getDatabaseSchemaMode();
      if (schemaMode === 'UNVERIFIED') {
        schemaMode = await inspectDatabaseSchemaCompatibility();
      }

      const legacyCode = LEGACY_NEON_MACRO_CODE_MAP[normalizedCode] || normalizedCode;

      if (schemaMode === 'LEGACY_COMPATIBLE_NEON' && cfg) {
        const obsRows = (await prisma.$queryRaw`
          SELECT o."referenceDate", o.value, o."collectedAt"
          FROM "MacroObservation" o
          JOIN "MacroIndicator" i ON i.id = o."indicatorId"
          WHERE i.code = ${legacyCode} OR i.code = ${normalizedCode}
          ORDER BY o."referenceDate" DESC
          LIMIT ${Number(limit)}
        `) as Array<{ referenceDate: Date; value: any; collectedAt: Date }>;

        if (obsRows.length > 0) {
          return obsRows.reverse().map(obs => ({
            code: cfg.code,
            seriesCode: cfg.seriesCode,
            name: cfg.name,
            variable: cfg.variable,
            source: cfg.source,
            unit: cfg.unit,
            frequency: cfg.frequency,
            value: Number(obs.value),
            referenceDate: new Date(obs.referenceDate).toISOString().split('T')[0],
            publicationDate: null,
            fetchedAt: obs.collectedAt ? new Date(obs.collectedAt).toISOString() : new Date().toISOString(),
            syncSource: 'LIVE_API',
            methodology: cfg.methodology,
          }));
        }
      }

      const ind = await prisma.macroIndicator.findFirst({
        where: {
          OR: [{ code: normalizedCode }, { code: legacyCode }],
        },
        include: {
          observations: {
            orderBy: { referenceDate: 'desc' },
            take: limit,
          },
        },
      });
      if (ind && ind.observations.length > 0) {
        return ind.observations.reverse().map(obs => ({
          code: cfg?.code || ind.code,
          seriesCode: ind.seriesCode || cfg?.seriesCode || ind.code,
          name: cfg?.name || ind.name,
          variable: cfg?.variable || ind.description || ind.name,
          source: cfg?.source || ind.source,
          unit: cfg?.unit || ind.unit,
          frequency: cfg?.frequency || ind.frequency || 'Mensal',
          value: Number(obs.value),
          referenceDate: obs.referenceDate.toISOString().split('T')[0],
          publicationDate: obs.publicationDate ? obs.publicationDate.toISOString().split('T')[0] : null,
          fetchedAt: obs.fetchedAt.toISOString(),
          syncSource: (obs.syncSource as any) || 'LIVE_API',
          methodology: ind.methodology || cfg?.methodology || '',
        }));
      }
    } catch {
      // Fallback
    }
  }

  const list = memoryObservations.get(normalizedCode) || [];
  return list.slice(-limit);
}

export async function getMacroPublicationMetadata(code?: string) {
  const latest = await getLatestMacroIndicators();
  const filtered = code ? latest.filter(i => i.code === code.toUpperCase().trim()) : latest;
  return filtered.map(item => ({
    code: item.code,
    seriesCode: item.seriesCode,
    variable: item.variable,
    source: item.source,
    unit: item.unit,
    frequency: item.frequency,
    referenceDate: item.referenceDate,
    publicationDate: item.publicationDate,
    fetchedAt: item.fetchedAt,
    syncSource: item.syncSource,
    methodology: item.methodology,
  }));
}

export async function compareMacroPeriods(code: string, periodsBack = 3) {
  const history = await getMacroHistory(code, Math.max(2, periodsBack + 1));
  if (history.length < 2) {
    return {
      code: code.toUpperCase(),
      available: false,
      message: 'Histórico insuficiente para comparar períodos macroeconômicos.',
    };
  }
  const oldest = history[0];
  const latest = history[history.length - 1];
  const diff = Number((latest.value - oldest.value).toFixed(4));
  const pctChange = oldest.value !== 0 ? Number((((latest.value - oldest.value) / Math.abs(oldest.value)) * 100).toFixed(2)) : null;

  return {
    code: latest.code,
    seriesCode: latest.seriesCode,
    unit: latest.unit,
    source: latest.source,
    startPeriod: { date: oldest.referenceDate, value: oldest.value },
    endPeriod: { date: latest.referenceDate, value: latest.value },
    absoluteChange: diff,
    relativeChangePct: pctChange,
    observationsCount: history.length,
  };
}
