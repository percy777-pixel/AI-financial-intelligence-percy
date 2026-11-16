import crypto from 'crypto';
import {
  extractAndValidateImportRow,
  parseCsvBuffer,
  parseXlsxBuffer,
  suggestColumnMapping,
} from './importService.js';
import {
  getCompanyById,
  listAnalysisReports,
  listAutomationRuns,
  saveAutomationRun,
  saveFinancialPeriodVersion,
  StoredAutomationRun,
} from './dataStore.js';
import { generateExecutiveReport, ExecutiveReportPayload } from './reportService.js';

const activeRunLocks = new Set<string>();

export interface WebhookDiagnosticsBreakdown {
  webhookConfigured: boolean;
  webhookReachable: boolean | null;
  authApproved: boolean | null;
  executionPerformed: boolean;
  executionSucceeded: boolean;
}

export interface WebhookConfigStatus {
  configured: boolean;
  secretConfigured: boolean;
  authMode: 'HEADER_SECRET' | 'HMAC';
  authHeaderName: 'X-N8N-Webhook-Secret';
  hmacEnabled: boolean;
  provider: 'n8n_webhook';
  endpointMasked: string | null;
  tested: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  diagnostics: WebhookDiagnosticsBreakdown;
  note: string;
}

interface LastWebhookTestState {
  tested: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  webhookReachable: boolean | null;
  authApproved: boolean | null;
  executionPerformed: boolean;
  executionSucceeded: boolean;
}

let lastWebhookTestState: LastWebhookTestState = {
  tested: false,
  lastTestedAt: null,
  lastTestStatus: null,
  webhookReachable: null,
  authApproved: null,
  executionPerformed: false,
  executionSucceeded: false,
};

export function resetWebhookTestStateForTesting(): void {
  lastWebhookTestState = {
    tested: false,
    lastTestedAt: null,
    lastTestStatus: null,
    webhookReachable: null,
    authApproved: null,
    executionPerformed: false,
    executionSucceeded: false,
  };
}

function maskWebhookUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    const parts = parsed.hostname.split('.');
    const maskedHost =
      parts.length >= 3
        ? `[HOST_OCULTADO].${parts.slice(-2).join('.')}`
        : '[HOST_OCULTADO]';
    return `${parsed.protocol}//${maskedHost}/***`;
  } catch {
    return 'https://[HOST_OCULTADO]/***';
  }
}

export function getWebhookStatus(): WebhookConfigStatus {
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  const secretConfigured = Boolean(secret && secret.trim() !== '');
  const rawAuthMode = (process.env.N8N_WEBHOOK_AUTH_MODE || '').trim().toUpperCase();
  const hmacEnabled = rawAuthMode === 'HMAC';
  const authMode: 'HEADER_SECRET' | 'HMAC' = hmacEnabled ? 'HMAC' : 'HEADER_SECRET';

  if (!url || url.trim() === '') {
    return {
      configured: false,
      secretConfigured,
      authMode,
      authHeaderName: 'X-N8N-Webhook-Secret',
      hmacEnabled,
      provider: 'n8n_webhook',
      endpointMasked: null,
      tested: false,
      lastTestedAt: null,
      lastTestStatus: null,
      diagnostics: {
        webhookConfigured: false,
        webhookReachable: null,
        authApproved: null,
        executionPerformed: false,
        executionSucceeded: false,
      },
      note: 'Integração preparada via HTTP POST com Header Auth padrão do n8n (X-N8N-Webhook-Secret), porém NÃO CONFIGURADA (defina N8N_WEBHOOK_URL e N8N_WEBHOOK_SECRET no ambiente privado).',
    };
  }

  const masked = maskWebhookUrl(url);
  return {
    configured: true,
    secretConfigured,
    authMode,
    authHeaderName: 'X-N8N-Webhook-Secret',
    hmacEnabled,
    provider: 'n8n_webhook',
    endpointMasked: masked,
    tested: lastWebhookTestState.tested,
    lastTestedAt: lastWebhookTestState.lastTestedAt,
    lastTestStatus: lastWebhookTestState.lastTestStatus,
    diagnostics: {
      webhookConfigured: true,
      webhookReachable: lastWebhookTestState.webhookReachable,
      authApproved: lastWebhookTestState.authApproved,
      executionPerformed: lastWebhookTestState.executionPerformed,
      executionSucceeded: lastWebhookTestState.executionSucceeded,
    },
    note: lastWebhookTestState.tested
      ? `Endpoint configurado (${masked}) e verificado em ${lastWebhookTestState.lastTestedAt} (${lastWebhookTestState.lastTestStatus}).`
      : `Endpoint configurado (${masked}), porém ainda NÃO TESTADO em execução real. Header Auth via X-N8N-Webhook-Secret ${secretConfigured ? 'configurado' : 'ausente'}.`,
  };
}

export interface WebhookDispatchOptions {
  companyId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  recordRun?: boolean;
  isLiveTest?: boolean;
}

export interface WebhookDispatchResult {
  dispatched: boolean;
  status: string;
  httpStatus?: number;
  authHeaderName: 'X-N8N-Webhook-Secret';
  authHeaderSent: boolean;
  hmacSent: boolean;
  attemptsCount: number;
  durationMs: number;
  diagnostics: WebhookDiagnosticsBreakdown;
  reason?: string;
  runId?: string;
}

export async function dispatchWebhookEvent(
  eventType: string,
  payload: any,
  options?: WebhookDispatchOptions
): Promise<WebhookDispatchResult> {
  const t0 = Date.now();
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET || '';
  const hasSecret = secret.trim().length > 0;
  const rawAuthMode = (process.env.N8N_WEBHOOK_AUTH_MODE || '').trim().toUpperCase();
  const hmacEnabled = rawAuthMode === 'HMAC' && hasSecret;

  if (!url || url.trim() === '') {
    return {
      dispatched: false,
      status: 'NOT_CONFIGURED',
      authHeaderName: 'X-N8N-Webhook-Secret',
      authHeaderSent: false,
      hmacSent: false,
      attemptsCount: 0,
      durationMs: 0,
      diagnostics: {
        webhookConfigured: false,
        webhookReachable: false,
        authApproved: false,
        executionPerformed: false,
        executionSucceeded: false,
      },
      reason: 'N8N_WEBHOOK_URL ausente no ambiente privado.',
    };
  }

  const fetchFn = options?.fetchImpl || fetch;
  const timeoutMs = options?.timeoutMs ?? 6000;
  const maxRetries = options?.maxRetries ?? (options?.fetchImpl ? 0 : 1);
  const shouldRecordRun = options?.recordRun !== false && Boolean(options?.companyId || payload?.companyId);
  const companyId = options?.companyId || payload?.companyId;
  const runId = shouldRecordRun ? `wh-${crypto.randomUUID().slice(0, 8)}` : undefined;
  const startedAt = new Date().toISOString();

  const body = JSON.stringify({
    eventType,
    timestamp: startedAt,
    payload,
  });

  // Never log or expose the secret value; send literal secret in X-N8N-Webhook-Secret per n8n Header Auth contract
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(hasSecret ? { 'X-N8N-Webhook-Secret': secret } : {}),
    ...(hmacEnabled
      ? { 'X-AFI-Signature': crypto.createHmac('sha256', secret).update(body).digest('hex') }
      : {}),
  };

  let attemptsCount = 0;
  let lastError: any = null;
  let lastHttpStatus: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attemptsCount++;
    try {
      const res = await fetchFn(url.trim(), {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers,
        body,
      });

      lastHttpStatus = res.status;
      const isTransientServerErr = [502, 503, 504].includes(res.status);
      if (isTransientServerErr && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }

      const durationMs = Date.now() - t0;
      const isOk = res.ok && res.status >= 200 && res.status < 300;
      const isAuthFailure = res.status === 401 || res.status === 403;
      const statusLabel = isOk ? 'DELIVERED' : `HTTP_${res.status}`;
      const reason = isOk
        ? undefined
        : isAuthFailure
          ? `Falha de autenticação no webhook n8n (HTTP ${res.status}): verifique o segredo configurado em X-N8N-Webhook-Secret.`
          : `Servidor n8n respondeu com HTTP ${res.status}.`;

      const diagnostics: WebhookDiagnosticsBreakdown = {
        webhookConfigured: true,
        webhookReachable: true,
        authApproved: !isAuthFailure,
        executionPerformed: true,
        executionSucceeded: isOk,
      };

      if (!options?.fetchImpl) {
        lastWebhookTestState = {
          tested: isOk,
          lastTestedAt: new Date().toISOString(),
          lastTestStatus: statusLabel,
          webhookReachable: true,
          authApproved: !isAuthFailure,
          executionPerformed: true,
          executionSucceeded: isOk,
        };
      }

      if (shouldRecordRun && runId && companyId) {
        await saveAutomationRun({
          id: runId,
          companyId,
          workflowType: 'N8N_WEBHOOK_DISPATCH',
          status: isOk ? 'COMPLETED' : 'FAILED',
          steps: [
            {
              step: `Disparo Webhook n8n (${eventType})`,
              status: isOk ? 'COMPLETED' : 'FAILED',
              detail: isOk
                ? `Entregue com sucesso (HTTP ${res.status}, tentativas: ${attemptsCount}) usando Header Auth X-N8N-Webhook-Secret.`
                : `Falha HTTP ${res.status} ao enviar evento ${eventType} (tentativas: ${attemptsCount}).`,
              durationMs,
            },
          ],
          metrics: {
            eventType,
            httpStatus: res.status,
            authHeaderSent: hasSecret,
            hmacSent: hmacEnabled,
            attemptsCount,
            durationMs,
            diagnostics,
          },
          errorMessage: reason,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs,
        });
      }

      return {
        dispatched: isOk,
        status: statusLabel,
        httpStatus: res.status,
        authHeaderName: 'X-N8N-Webhook-Secret',
        authHeaderSent: hasSecret,
        hmacSent: hmacEnabled,
        attemptsCount,
        durationMs,
        diagnostics,
        reason,
        runId,
      };
    } catch (err: any) {
      lastError = err;
      const rawMsg = String(err?.message || err || '');
      const isTimeout =
        err?.name === 'TimeoutError' ||
        err?.name === 'AbortError' ||
        /timeout|timed out|aborted/i.test(rawMsg);
      if (!isTimeout && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      break;
    }
  }

  const durationMs = Date.now() - t0;
  const rawMsg = String(lastError?.message || lastError || 'Erro de rede');
  const isTimeout =
    lastError?.name === 'TimeoutError' ||
    lastError?.name === 'AbortError' ||
    /timeout|timed out|aborted/i.test(rawMsg);
  const statusLabel = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
  const sanitizedReason = isTimeout
    ? `Timeout após ${timeoutMs}ms aguardando resposta do webhook n8n.`
    : `Falha de conexão com o webhook n8n: ${rawMsg.replace(/https?:\/\/[^\s"']+/g, '[URL_OCULTADA]').replace(/[a-z0-9.-]+\.n8n\.cloud/gi, '[HOST_OCULTADO]')}`;

  const diagnostics: WebhookDiagnosticsBreakdown = {
    webhookConfigured: true,
    webhookReachable: false,
    authApproved: null,
    executionPerformed: true,
    executionSucceeded: false,
  };

  if (!options?.fetchImpl) {
    lastWebhookTestState = {
      tested: false,
      lastTestedAt: new Date().toISOString(),
      lastTestStatus: statusLabel,
      webhookReachable: false,
      authApproved: null,
      executionPerformed: true,
      executionSucceeded: false,
    };
  }

  if (shouldRecordRun && runId && companyId) {
    await saveAutomationRun({
      id: runId,
      companyId,
      workflowType: 'N8N_WEBHOOK_DISPATCH',
      status: 'FAILED',
      steps: [
        {
          step: `Disparo Webhook n8n (${eventType})`,
          status: 'FAILED',
          detail: sanitizedReason,
          durationMs,
        },
      ],
      metrics: {
        eventType,
        httpStatus: lastHttpStatus,
        authHeaderSent: hasSecret,
        hmacSent: hmacEnabled,
        attemptsCount,
        durationMs,
        diagnostics,
      },
      errorMessage: sanitizedReason,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs,
    });
  }

  return {
    dispatched: false,
    status: statusLabel,
    authHeaderName: 'X-N8N-Webhook-Secret',
    authHeaderSent: hasSecret,
    hmacSent: hmacEnabled,
    attemptsCount,
    durationMs,
    diagnostics,
    reason: sanitizedReason,
    runId,
  };
}

export async function testWebhookConnection(
  companyId: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number }
): Promise<WebhookDispatchResult> {
  return dispatchWebhookEvent(
    'n8n.connection_test',
    {
      companyId,
      testInitiatedByUser: true,
      message: 'Teste explícito de conectividade e Header Auth (X-N8N-Webhook-Secret) do AI Financial Intelligence.',
    },
    {
      companyId,
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs ?? 6000,
      maxRetries: options?.maxRetries,
      recordRun: true,
      isLiveTest: true,
    }
  );
}

export interface AutomatedPipelineResult {
  run: StoredAutomationRun;
  needsCorrection: boolean;
  headers?: string[];
  suggestedMapping?: Record<string, string>;
  validation?: any;
  savedPeriod?: any;
  report?: ExecutiveReportPayload;
  webhookResult?: WebhookDispatchResult | { dispatched: boolean; status: string; reason: string };
}

export async function runAutomatedImportPipeline(params: {
  companyId: string;
  fileBuffer: Buffer;
  fileName: string;
  year: number;
  month: number | null;
  periodType?: string;
  overrideMapping?: Record<string, string>;
  rowIndex?: number;
  dispatchWebhook?: boolean;
  rejectDuplicate?: boolean;
}): Promise<AutomatedPipelineResult> {
  const lockKey = `${params.companyId}:${params.year}:${params.month || 0}`;
  if (activeRunLocks.has(lockKey)) {
    throw new Error('Já existe uma automação em andamento para esta empresa e período. Aguarde a conclusão.');
  }

  activeRunLocks.add(lockKey);
  const runId = `auto-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const steps: StoredAutomationRun['steps'] = [
    { step: '1. Leitura do arquivo (CSV/XLSX)', status: 'PENDING' },
    { step: '2. Identificação de estrutura e mapeamento', status: 'PENDING' },
    { step: '3. Validação contábil e inconsistências', status: 'PENDING' },
    { step: '4. Cálculo determinístico DRE + Indicadores + Versão', status: 'PENDING' },
    { step: '5. Geração de Diagnóstico e Relatório Executivo', status: 'PENDING' },
  ];

  const runRecord: StoredAutomationRun = {
    id: runId,
    companyId: params.companyId,
    workflowType: 'IMPORT_TO_REPORT',
    status: 'RUNNING',
    steps,
    startedAt,
  };
  await saveAutomationRun(runRecord);

  try {
    const company = await getCompanyById(params.companyId);
    if (!company) {
      throw new Error('Empresa não encontrada.');
    }

    // Step 1: Parse
    const s1 = Date.now();
    steps[0].status = 'RUNNING';
    const lowerName = params.fileName.toLowerCase();
    const parsed = lowerName.endsWith('.csv')
      ? parseCsvBuffer(params.fileBuffer)
      : lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
        ? parseXlsxBuffer(params.fileBuffer)
        : { headers: [], rows: [], fileName: params.fileName, error: 'Formato não suportado. Use .csv ou .xlsx.' };

    if (parsed.error || parsed.rows.length === 0) {
      steps[0].status = 'FAILED';
      steps[0].detail = parsed.error || 'Planilha sem linhas de dados.';
      steps[0].durationMs = Date.now() - s1;
      runRecord.status = 'FAILED';
      runRecord.errorMessage = steps[0].detail;
      runRecord.completedAt = new Date().toISOString();
      runRecord.durationMs = Date.now() - t0;
      await saveAutomationRun(runRecord);
      return { run: runRecord, needsCorrection: true };
    }
    steps[0].status = 'COMPLETED';
    steps[0].detail = `${parsed.rows.length} linha(s) e ${parsed.headers.length} coluna(s) detectadas.`;
    steps[0].durationMs = Date.now() - s1;

    // Step 2: Mapping
    const s2 = Date.now();
    steps[1].status = 'RUNNING';
    const suggestedMapping = suggestColumnMapping(parsed.headers);
    const activeMapping =
      params.overrideMapping && Object.keys(params.overrideMapping).length > 0
        ? params.overrideMapping
        : suggestedMapping;
    steps[1].status = 'COMPLETED';
    steps[1].detail = `${Object.keys(activeMapping).length} campos financeiros mapeados.`;
    steps[1].durationMs = Date.now() - s2;

    // Step 3: Strict Validation (Never confirm silently without validation!)
    const s3 = Date.now();
    steps[2].status = 'RUNNING';
    const rowIndex = params.rowIndex ?? 0;
    if (rowIndex < 0 || rowIndex >= parsed.rows.length) {
      throw new Error(`Índice de linha inválido (${rowIndex}). O arquivo possui ${parsed.rows.length} linha(s).`);
    }
    const targetRow = parsed.rows[rowIndex];
    const extracted = extractAndValidateImportRow(
      targetRow,
      activeMapping,
      company.taxRegime || 'Simples Nacional'
    );

    if (!extracted.validation.valid) {
      steps[2].status = 'FAILED';
      steps[2].detail = `Encontrados ${extracted.validation.errors.length} erro(s) impeditivo(s) de validação.`;
      steps[2].durationMs = Date.now() - s3;
      steps[3].status = 'SKIPPED';
      steps[4].status = 'SKIPPED';

      runRecord.status = 'NEEDS_CORRECTION';
      runRecord.errorMessage = extracted.validation.errors.join(' | ');
      runRecord.completedAt = new Date().toISOString();
      runRecord.durationMs = Date.now() - t0;
      runRecord.metrics = {
        rowsProcessed: 1,
        inconsistenciesCount: extracted.validation.errors.length + extracted.validation.warnings.length,
        missingFieldsCount: extracted.validation.missingFields.length,
        automatedStepsCompleted: 2,
      };
      await saveAutomationRun(runRecord);

      return {
        run: runRecord,
        needsCorrection: true,
        headers: parsed.headers,
        suggestedMapping: activeMapping,
        validation: extracted.validation,
      };
    }
    steps[2].status = 'COMPLETED';
    steps[2].detail = `Dados válidos (${extracted.validation.completenessPct}% de completude, ${extracted.validation.warnings.length} alerta(s), ${extracted.validation.missingFields.length} campo(s) opcional(is) ausente(s)).`;
    steps[2].durationMs = Date.now() - s3;

    // Step 4: Calculate & Persist
    const s4 = Date.now();
    steps[3].status = 'RUNNING';
    const savedPeriod = await saveFinancialPeriodVersion({
      companyId: params.companyId,
      year: params.year,
      month: params.month,
      periodType: params.periodType || 'MONTHLY',
      financialData: extracted.financialData as any,
      changeReason: `Automação completa via ${params.fileName}`,
      rejectDuplicate: params.rejectDuplicate,
    });
    steps[3].status = 'COMPLETED';
    steps[3].detail = savedPeriod.duplicateDetected
      ? `Importação idêntica à versão ativa v${savedPeriod.versionNumber} detectada (sem duplicação desnecessária).`
      : `Período salvo como versão v${savedPeriod.versionNumber}.`;
    steps[3].durationMs = Date.now() - s4;

    // Step 5: Generate Executive Report
    const s5 = Date.now();
    steps[4].status = 'RUNNING';
    const report = await generateExecutiveReport(params.companyId, params.year, params.month ?? undefined);
    steps[4].status = 'COMPLETED';
    steps[4].detail = `Relatório Executivo ${report.reportId} gerado (${report.provider}).`;
    steps[4].durationMs = Date.now() - s5;

    // Only dispatch external webhook if explicitly requested by the user/caller
    const webhookResult = params.dispatchWebhook
      ? await dispatchWebhookEvent(
          'executive_report.generated',
          {
            companyId: params.companyId,
            reportId: report.reportId,
            periodRef: report.periodRef,
          },
          { companyId: params.companyId, recordRun: true }
        )
      : {
          dispatched: false,
          status: 'SKIPPED_BY_DEFAULT',
          reason: 'Disparo externo de webhook n8n requer autorização explícita (dispatchWebhook=true).',
        };

    runRecord.status = 'COMPLETED';
    runRecord.completedAt = new Date().toISOString();
    runRecord.durationMs = Date.now() - t0;
    runRecord.metrics = {
      rowsProcessed: 1,
      inconsistenciesCount: extracted.validation.warnings.length,
      missingFieldsCount: extracted.validation.missingFields.length,
      completenessPct: extracted.validation.completenessPct,
      automatedStepsCompleted: 5,
      parseAndValidateMs: (steps[0].durationMs || 0) + (steps[1].durationMs || 0) + (steps[2].durationMs || 0),
      calculationMs: steps[3].durationMs || 0,
      reportGenerationMs: steps[4].durationMs || 0,
      totalMs: runRecord.durationMs,
      webhookStatus: webhookResult.status,
    };
    await saveAutomationRun(runRecord);

    return {
      run: runRecord,
      needsCorrection: false,
      headers: parsed.headers,
      suggestedMapping: activeMapping,
      validation: extracted.validation,
      savedPeriod,
      report,
      webhookResult,
    };
  } catch (err: any) {
    const activeStep = steps.find(s => s.status === 'RUNNING') || steps[0];
    activeStep.status = 'FAILED';
    activeStep.detail = err.message;
    runRecord.status = 'FAILED';
    runRecord.errorMessage = err.message;
    runRecord.completedAt = new Date().toISOString();
    runRecord.durationMs = Date.now() - t0;
    await saveAutomationRun(runRecord);
    throw err;
  } finally {
    activeRunLocks.delete(lockKey);
  }
}

export async function getAutomationTelemetrySummary(companyId: string) {
  const runs = await listAutomationRuns(companyId, 50);
  const reports = await listAnalysisReports(companyId);

  const completed = runs.filter(r => r.status === 'COMPLETED');
  const failedOrNeedsFix = runs.filter(r => r.status === 'FAILED' || r.status === 'NEEDS_CORRECTION');

  const avgDurationMs =
    completed.length > 0
      ? Math.round(completed.reduce((acc, r) => acc + (r.durationMs || 0), 0) / completed.length)
      : null;

  const totalInconsistenciesDetected = runs.reduce(
    (acc, r) => acc + Number(r.metrics?.inconsistenciesCount || 0),
    0
  );

  const totalStepsAutomated = completed.reduce(
    (acc, r) => acc + Number(r.metrics?.automatedStepsCompleted || 0),
    0
  );

  return {
    totalRuns: runs.length,
    completedRuns: completed.length,
    failedOrBlockedRuns: failedOrNeedsFix.length,
    reportsGeneratedCount: reports.length,
    avgExecutionDurationMs: avgDurationMs,
    totalInconsistenciesDetected,
    totalStepsAutomated,
    recentRuns: runs.slice(0, 10),
  };
}
