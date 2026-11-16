import crypto from 'crypto';
import { ThinkingLevel } from '@google/genai';
import {
  classifyAndRecordGeminiError,
  DEFAULT_GEMINI_TIMEOUT_MS,
  GEMINI_MODEL,
  getCandidateGeminiModels,
  getGeminiClient,
  withTimeout,
} from './aiService.js';
import {
  AGENT_FUNCTION_DECLARATIONS,
  executeAgentTool,
  ToolExecutionEnvelope,
} from './agentTools.js';
import { getCompanyById, saveAgentExecutionLog } from './dataStore.js';
import { fetchTextileSectorNewsRadar } from './sectorNewsService.js';

export interface AgentStepEvent {
  type: 'interpreting' | 'tool_start' | 'tool_result' | 'synthesizing' | 'completed' | 'error';
  timestamp: string;
  message: string;
  toolName?: string;
  args?: any;
  result?: ToolExecutionEnvelope;
}

export interface AgentRunResult {
  executionId: string;
  companyId: string;
  companyName: string;
  question: string;
  provider: 'GEMINI' | 'LOCAL_FALLBACK';
  modelUsed: string;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED';
  answer: string;
  steps: AgentStepEvent[];
  toolsCalled: Array<{
    toolName: string;
    args: any;
    ok: boolean;
    durationMs: number;
    source: string;
    dataVersions: string[];
    dataPreview: any;
  }>;
  sources: string[];
  dataVersionsUsed: string[];
  tokenUsage?: any;
  durationMs: number;
  fallbackReason?: string;
  error?: string;
}

export const MAX_AGENT_ITERATIONS = 6;
export const MAX_TOOL_CALLS = 14;
const PROMPT_INJECTION_REGEX = /(ignore\s+(all\s+)?previous\s+instructions|system\s+prompt|reveal\s+(api|secret|env)\s*key|process\.env|DROP\s+TABLE|SELECT\s+\*\s+FROM)/i;

export async function runFinancialAgent(params: {
  companyId: string;
  question: string;
  year?: number;
  month?: number;
  onEvent?: (ev: AgentStepEvent) => void;
  aiClientOverride?: any;
  timeoutMs?: number;
  maxIterationsOverride?: number;
}): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const executionId = `exec-${crypto.randomUUID().slice(0, 8)}`;
  const steps: AgentStepEvent[] = [];
  const toolsCalled: AgentRunResult['toolsCalled'] = [];
  const sourcesSet = new Set<string>();
  const versionsSet = new Set<string>();

  const emit = (ev: Omit<AgentStepEvent, 'timestamp'>) => {
    const full: AgentStepEvent = { ...ev, timestamp: new Date().toISOString() };
    steps.push(full);
    params.onEvent?.(full);
  };

  const company = await getCompanyById(params.companyId);
  if (!company) {
    const errMsg = `Empresa "${params.companyId}" não encontrada ou sem permissão de acesso.`;
    emit({ type: 'error', message: errMsg });
    await saveAgentExecutionLog({
      executionId,
      companyId: null,
      question: params.question,
      toolsCalled: [],
      modelUsed: 'none',
      provider: 'LOCAL_FALLBACK',
      durationMs: Date.now() - startedAt,
      status: 'BLOCKED',
      error: errMsg,
    });
    throw new Error(errMsg);
  }

  // Input validation & prompt-injection / secret-extraction guard
  const cleanQuestion = (params.question || '').trim();
  if (!cleanQuestion || cleanQuestion.length > 1500) {
    throw new Error('A pergunta deve ter entre 1 e 1500 caracteres.');
  }

  if (PROMPT_INJECTION_REGEX.test(cleanQuestion)) {
    const blockMsg =
      'Solicitação bloqueada pela política de governança: não é permitido tentar extrair segredos, alterar instruções de sistema ou executar comandos SQL arbitrários.';
    emit({ type: 'error', message: blockMsg });
    await saveAgentExecutionLog({
      executionId,
      companyId: company.id,
      question: cleanQuestion,
      toolsCalled: [],
      modelUsed: 'security-policy-guard',
      provider: 'LOCAL_FALLBACK',
      durationMs: Date.now() - startedAt,
      status: 'BLOCKED',
      error: blockMsg,
      finalResponse: blockMsg,
    });
    return {
      executionId,
      companyId: company.id,
      companyName: company.name,
      question: cleanQuestion,
      provider: 'LOCAL_FALLBACK',
      modelUsed: 'security-policy-guard',
      status: 'BLOCKED',
      answer: blockMsg,
      steps,
      toolsCalled: [],
      sources: [],
      dataVersionsUsed: [],
      durationMs: Date.now() - startedAt,
      error: blockMsg,
    };
  }

  emit({
    type: 'interpreting',
    message: `Interpretando solicitação para ${company.name} (${company.taxRegime || 'Regime padrão'})...`,
  });

  const toolCtx = {
    authorizedCompanyId: company.id,
    requestedYear: params.year,
    requestedMonth: params.month,
  };

  // Deduplication cache within the same execution to avoid redundant tool calls & cost
  const toolCache = new Map<string, ToolExecutionEnvelope>();

  const invokeTool = async (name: string, args: any): Promise<ToolExecutionEnvelope> => {
    const cacheKey = `${name}:${JSON.stringify(args || {})}`;
    if (toolCache.has(cacheKey)) {
      return toolCache.get(cacheKey)!;
    }
    if (toolsCalled.length >= MAX_TOOL_CALLS) {
      return {
        ok: false,
        toolName: name,
        error: `Limite máximo de ${MAX_TOOL_CALLS} chamadas de ferramentas por tarefa atingido.`,
        source: 'Cost & Loop Control',
        dataVersions: [],
        durationMs: 0,
      };
    }

    emit({
      type: 'tool_start',
      toolName: name,
      args,
      message: `Executando ferramenta ${name}...`,
    });

    const envelope = await executeAgentTool(name, args, toolCtx);
    toolCache.set(cacheKey, envelope);

    toolsCalled.push({
      toolName: name,
      args,
      ok: envelope.ok,
      durationMs: envelope.durationMs,
      source: envelope.source,
      dataVersions: envelope.dataVersions,
      dataPreview: envelope.ok ? envelope.data : { error: envelope.error },
    });

    if (envelope.source) sourcesSet.add(envelope.source);
    for (const v of envelope.dataVersions) versionsSet.add(v);

    emit({
      type: 'tool_result',
      toolName: name,
      result: envelope,
      message: envelope.ok
        ? `Concluído: ${name} (${envelope.durationMs} ms)`
        : `Falha controlada em ${name}: ${envelope.error}`,
    });

    return envelope;
  };

  const ai = params.aiClientOverride !== undefined ? params.aiClientOverride : getGeminiClient();
  const timeoutMs = params.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  const maxIterations = params.maxIterationsOverride ?? MAX_AGENT_ITERATIONS;

  let finalAnswer = '';
  let provider: 'GEMINI' | 'LOCAL_FALLBACK' = 'LOCAL_FALLBACK';
  let modelUsed = 'deterministic-agent-router';
  let tokenUsage: any = null;
  let fallbackReason: string | undefined;

  if (ai) {
    const systemInstruction = `
Você é o Agente Principal do AI Financial Intelligence.
Empresa autorizada em contexto: "${company.name}" (ID: ${company.id}, Setor: ${company.industry || 'Geral'}, Regime: ${company.taxRegime || 'Simples Nacional'}).
${params.year ? `Período solicitado: ${params.month ? `${params.month}/` : ''}${params.year}.` : ''}

MISSÃO E REGRAS OBRIGATÓRIAS:
1. Você NUNCA deve calcular números financeiros "de cabeça" nem inventar valores. Sempre chame as ferramentas disponíveis (get_financial_context, get_dre, get_debt_exposure, get_macro_indicators, simulate_*, compare_financial_periods, identify_missing_information, etc.) para obter os números do motor determinístico.
2. Para perguntas complexas, selecione apenas as ferramentas realmente necessárias (tipicamente 2 a 5 ferramentas) evitando chamadas redundantes para controlar custo e latência.
3. Separe explicitamente na sua resposta final:
   - **Fatos Observados** (com números e versões exatas retornadas pelas ferramentas)
   - **Hipóteses** (possíveis explicações que exigem verificação, sem tratá-las como certezas)
   - **Estimativas / Simulações** (sempre declarando premissas)
   - **Riscos e Ações Prioritárias**
   - **Dados Ausentes e Limitações** (sempre relate o que faltou nas ferramentas)
4. Nunca acesse outra empresa além de ${company.id}. Se o usuário pedir dados de outra empresa, recuse educadamente.
5. Responda em Português (Brasil) claro, executivo e rastreável.
    `.trim();

    const candidateModels = getCandidateGeminiModels();
    if (candidateModels.length === 0) {
      fallbackReason =
        'Cota gratuita da API Gemini temporariamente em espera; executado via roteador determinístico local.';
    }

    for (const candidateModel of candidateModels) {
      try {
        provider = 'GEMINI';
        modelUsed = candidateModel;

        const contents: any[] = [
          { role: 'user', parts: [{ text: cleanQuestion }] },
        ];

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let modelAnswer = '';

        for (let iter = 0; iter < maxIterations; iter++) {
          const modelConfig: any = {
            systemInstruction,
            tools: [{ functionDeclarations: AGENT_FUNCTION_DECLARATIONS }],
          };
          if (candidateModel === GEMINI_MODEL) {
            modelConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.MEDIUM };
          }

          const response = await withTimeout<any>(
            ai.models.generateContent({
              model: candidateModel,
              contents,
              config: modelConfig,
            }),
            timeoutMs,
            `Agent generateContent(${candidateModel}, iter=${iter + 1})`
          );

          if (!response || typeof response !== 'object') {
            const invalidErr: any = new Error('INVALID_MODEL_RESPONSE: Objeto de resposta nulo ou inválido retornado pelo modelo.');
            invalidErr.isInvalidResponse = true;
            throw invalidErr;
          }

          if (response.usageMetadata) {
            totalInputTokens += response.usageMetadata.promptTokenCount || 0;
            totalOutputTokens += response.usageMetadata.candidatesTokenCount || 0;
          }

          const candidateContent = response.candidates?.[0]?.content;
          const functionCalls = response.functionCalls;

          if (!functionCalls || functionCalls.length === 0) {
            const textResp = typeof response.text === 'string' ? response.text.trim() : '';
            if (!textResp) {
              const invalidErr: any = new Error(
                'INVALID_MODEL_RESPONSE: Modelo retornou resposta sem chamadas de ferramenta e sem texto.'
              );
              invalidErr.isInvalidResponse = true;
              throw invalidErr;
            }
            emit({ type: 'synthesizing', message: 'Sintetizando resposta executiva fundamentada...' });
            modelAnswer = textResp;
            break;
          }

          if (candidateContent) {
            contents.push(candidateContent);
          } else {
            contents.push({
              role: 'model',
              parts: functionCalls.map((fc: any) => ({ functionCall: fc })),
            });
          }

          const responseParts: any[] = [];
          for (const fc of functionCalls) {
            const fcName = fc.name || 'unknown_tool';
            const envelope = await invokeTool(fcName, fc.args || {});
            responseParts.push({
              functionResponse: {
                id: fc.id,
                name: fcName,
                response: envelope.ok
                  ? { result: envelope.data, source: envelope.source, versions: envelope.dataVersions }
                  : { error: envelope.error },
              },
            });
          }

          contents.push({ role: 'user', parts: responseParts });

          if (iter === maxIterations - 1) {
            emit({ type: 'synthesizing', message: 'Limite de iterações atingido; consolidando resultados coletados...' });
            const finalTurn = await withTimeout<any>(
              ai.models.generateContent({
                model: candidateModel,
                contents: [
                  ...contents,
                  {
                    role: 'user',
                    parts: [
                      {
                        text: 'Com base nos resultados das ferramentas acima, produza agora a síntese executiva final separando Fatos, Hipóteses, Estimativas, Riscos, Dados Ausentes e Limitações.',
                      },
                    ],
                  },
                ],
                config: { systemInstruction },
              }),
              timeoutMs,
              `Agent finalTurn(${candidateModel})`
            );
            modelAnswer =
              (typeof finalTurn?.text === 'string' && finalTurn.text.trim()) ||
              'Análise concluída após atingir o limite máximo de iterações com base nas ferramentas executadas.';
          }
        }

        if (modelAnswer) {
          finalAnswer = modelAnswer;
          tokenUsage = {
            promptTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
          };
          fallbackReason = undefined;
          break;
        }
      } catch (err: any) {
        const classified = classifyAndRecordGeminiError(candidateModel, err);
        fallbackReason = classified.userMessage;
        console.info(
          `Agent model ${candidateModel} unavailable (${
            classified.isQuota ? '429 quota' : classified.isTimeout ? 'timeout' : 'fallback'
          }); switching seamlessly.`
        );
        provider = 'LOCAL_FALLBACK';
        modelUsed = 'deterministic-agent-router';
      }
    }
  } else {
    fallbackReason = 'GEMINI_API_KEY ausente; executado via roteador determinístico local.';
  }

  // Deterministic Local Agentic Router (executes real backend tools when Gemini key is absent or quota-exhausted)
  if (provider === 'LOCAL_FALLBACK' || !finalAnswer) {
    provider = 'LOCAL_FALLBACK';
    modelUsed = 'deterministic-agent-router';
    finalAnswer = await runLocalDeterministicAgentPlan(cleanQuestion, invokeTool);
  }

  const durationMs = Date.now() - startedAt;
  const sources = Array.from(sourcesSet);
  const dataVersionsUsed = Array.from(versionsSet);

  emit({
    type: 'completed',
    message: `Execução concluída em ${durationMs} ms (${toolsCalled.length} ferramentas executadas).`,
  });

  await saveAgentExecutionLog({
    executionId,
    companyId: company.id,
    question: cleanQuestion,
    periodRef: params.year ? `${params.month || ''}/${params.year}` : undefined,
    dataVersionsUsed,
    toolsCalled: toolsCalled.map(t => t.toolName),
    validatedArgs: toolsCalled.map(t => ({ tool: t.toolName, args: t.args })),
    toolResults: toolsCalled.map(t => ({ tool: t.toolName, ok: t.ok, durationMs: t.durationMs })),
    modelUsed,
    provider,
    tokenUsage,
    durationMs,
    status: 'SUCCESS',
    finalResponse: finalAnswer,
  });

  return {
    executionId,
    companyId: company.id,
    companyName: company.name,
    question: cleanQuestion,
    provider,
    modelUsed,
    status: 'SUCCESS',
    answer: finalAnswer,
    steps,
    toolsCalled,
    sources,
    dataVersionsUsed,
    tokenUsage,
    durationMs,
    fallbackReason,
  };
}

export interface ExtractedInterestRateParams {
  currentRatePct?: number;
  targetRatePct?: number;
  shockPp?: number;
  ignoredShareMentions: string[];
}

function isToolSuccess(env: any): env is ToolExecutionEnvelope & { data: any } {
  return Boolean(
    env &&
      env.ok !== false &&
      env.success !== false &&
      env.data !== undefined &&
      env.data !== null
  );
}

function parseBrDecimal(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function isPlausibleInterestRate(val: number): boolean {
  return Number.isFinite(val) && val > 0 && val <= 50;
}

/**
 * Extracts explicit interest rate targets or shocks from user prompts while strictly ignoring
 * debt composition/indexation shares (e.g. "100% indexada ao CDI", "50% prefixada", "80% do CDI").
 */
export function extractInterestRateParamsFromQuestion(rawQuestion: string): ExtractedInterestRateParams {
  const q = (rawQuestion || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const ignoredShareMentions: string[] = [];

  // Mask composition/indexation shares so "100% indexada ao CDI" or "100% prefixada" is never treated as a rate.
  const shareRegex =
    /(\d+(?:[.,]\d+)?)\s*%\s*(?:indexad[oa]s?(?:\s+(?:ao?|em|no|na)\s*(?:cdi|selic|ipca))?|pre[-\s]?fixad[oa]s?|pos[-\s]?fixad[oa]s?|atrelad[oa]s?(?:\s+(?:ao?|em)\s*(?:cdi|selic|ipca))?|vinculad[oa]s?(?:\s+(?:ao?|em)\s*(?:cdi|selic|ipca))?|da\s+(?:divida|carteira|exposicao)|do\s+(?:total|endividamento|saldo|passivo|cdi|ipca)|em\s+(?:cdi|selic|prefixad[oa]s?|pre[-\s]?fixad[oa]s?))/gi;

  const masked = q.replace(shareRegex, match => {
    ignoredShareMentions.push(match.trim());
    return ' [COMPOSICAO_DIVIDA] ';
  });

  // Also mask explicit "divida de X% ..." or "parcela de X% ..." composition phrases when not describing a rate
  const maskedWithDebtPrefix = masked.replace(
    /(?:divida|carteira|parcela|exposicao)\s+(?:esta\s+|e\s+|de\s+|com\s+)?(\d+(?:[.,]\d+)?)\s*%(?!\s*(?:a\.?a\.?|ao\s+ano|para|->|a\s+\d))/gi,
    (match, _num) => {
      ignoredShareMentions.push(match.trim());
      return ' [COMPOSICAO_DIVIDA] ';
    }
  );

  // 1. Explicit transition: "de 13,75% para 15,75%" or "está em 13,75% e pode subir para 15,75%"
  const transitionRegex =
    /\b(?:de|passar\s+de|subir\s+de|cair\s+de|em)\s*(\d+(?:[.,]\d+)?)\s*%(?:\s*a\.?a\.?)?(?:\s*(?:e\s+(?:pode|deve|vai|chegar)?\s*(?:subir|aumentar|ir|passar|cair|reduzir)?|,|\s+a))?\s*(?:para|a|ate)\s*(\d+(?:[.,]\d+)?)\s*%/i;
  const transMatch = maskedWithDebtPrefix.match(transitionRegex);
  if (transMatch) {
    const fromVal = parseBrDecimal(transMatch[1]);
    const toVal = parseBrDecimal(transMatch[2]);
    if (isPlausibleInterestRate(fromVal) && isPlausibleInterestRate(toVal)) {
      return {
        currentRatePct: fromVal,
        targetRatePct: toVal,
        ignoredShareMentions,
      };
    }
  }

  // 2. Explicit shock in percentage points: "+2 p.p.", "aumento de 2 pontos percentuais"
  const shockRegex =
    /(?:(queda|cair|reducao|reduzir|recuo|baixa)\s+(?:de\s*)?)?([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:p\.?p\.?|pontos?\s+percentuais?)/i;
  const shockMatch = maskedWithDebtPrefix.match(shockRegex);
  if (shockMatch) {
    const rawSignWord = shockMatch[1];
    const numVal = parseBrDecimal(shockMatch[2].replace(/\s+/g, ''));
    if (Number.isFinite(numVal) && Math.abs(numVal) > 0 && Math.abs(numVal) <= 25) {
      const signed = rawSignWord && numVal > 0 ? -numVal : numVal;
      return {
        shockPp: signed,
        ignoredShareMentions,
      };
    }
  }

  // 3. Explicit single target rate: "selic para 15%", "cdi subir para 15,75%", "taxa de 14%"
  const singleTargetRegex =
    /(?:\b(?:selic|cdi|taxa(?:\s+de\s+juros)?|juros)\b[^.!?\n]{0,25}?\b(?:para|a|ate|de|em)\b|\b(?:subir|ir|chegar|cair|reduzir)\s+(?:para|a|ate))\s*(\d+(?:[.,]\d+)?)\s*%/i;
  const singleMatch = maskedWithDebtPrefix.match(singleTargetRegex);
  if (singleMatch) {
    const targetVal = parseBrDecimal(singleMatch[1]);
    if (isPlausibleInterestRate(targetVal)) {
      return {
        targetRatePct: targetVal,
        ignoredShareMentions,
      };
    }
  }

  return { ignoredShareMentions };
}

function formatMacroReferenceLine(
  macroEnv: any,
  preferredCode: 'CDI' | 'SELIC'
): { indicator: any; line: string; isMissingOrOutdated: boolean } {
  if (!isToolSuccess(macroEnv) || !Array.isArray(macroEnv.data) || macroEnv.data.length === 0) {
    const reason = macroEnv?.error ? ` (${macroEnv.error})` : '';
    return {
      indicator: null,
      line: `Indisponível / não retornado pela ferramenta macroeconômica${reason}.`,
      isMissingOrOutdated: true,
    };
  }

  const indicator =
    macroEnv.data.find((m: any) => m.code === preferredCode) ||
    macroEnv.data.find((m: any) => m.code === 'SELIC') ||
    macroEnv.data.find((m: any) => m.code === 'CDI');

  if (!indicator || typeof indicator.value !== 'number') {
    return {
      indicator: null,
      line: `Indicador ${preferredCode}/SELIC ausente na resposta macroeconômica.`,
      isMissingOrOutdated: true,
    };
  }

  const isLocalRef = indicator.syncSource !== 'LIVE_API';
  const statusTag = isLocalRef
    ? `referência local em cache (pode estar desatualizada; ref. ${indicator.referenceDate || 'N/A'})`
    : `API oficial ao vivo (ref. ${indicator.referenceDate || 'N/A'})`;

  return {
    indicator,
    line: `${indicator.code}: ${indicator.value}${indicator.unit || '% a.a.'} — ${indicator.source || 'BCB'} [${statusTag}]`,
    isMissingOrOutdated: isLocalRef,
  };
}

/**
 * Deterministic multi-tool orchestrator for LOCAL_FALLBACK mode (without external LLM).
 * Still calls real backend tools & Decimal.js financial engine; clearly labeled as Fallback Local.
 */
export async function runLocalDeterministicAgentPlan(
  question: string,
  invokeTool: (name: string, args: any) => Promise<ToolExecutionEnvelope>
): Promise<string> {
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const profileEnv = await invokeTool('get_company_profile', {});
  const contextEnv = await invokeTool('get_financial_context', {});
  const sections: string[] = [
    `### Resposta Executiva (Modo Fallback Local — Roteador Determinístico de Ferramentas)`,
    `> *Nota de transparência: Executado sem síntese generativa externa (modelo Gemini indisponível ou chave não configurada). Todos os números abaixo foram apurados exclusivamente pelas ferramentas determinísticas do backend.*`,
    ``,
  ];

  const profileData = isToolSuccess(profileEnv) ? profileEnv.data : null;
  const ctx = isToolSuccess(contextEnv) ? contextEnv.data : null;
  const compName = profileData?.name || 'Empresa em contexto';
  const regimeLabel = profileData?.taxRegime || 'Regime não informado';
  const periodLabel = ctx?.period || 'Período não informado';

  // Detect Selic / CDI / interest rate / debt composition questions
  if (
    q.includes('selic') ||
    q.includes('juro') ||
    q.includes('cdi') ||
    q.includes('endivid') ||
    q.includes('divida') ||
    q.includes('prefixad') ||
    q.includes('pre-fixad') ||
    q.includes('pos-fixad')
  ) {
    const debtEnv = await invokeTool('get_debt_exposure', {});
    const macroEnv = await invokeTool('get_macro_indicators', {});
    const rateParams = extractInterestRateParamsFromQuestion(question);

    const preferCdi = q.includes('cdi') && !q.includes('selic');
    const macroRef = formatMacroReferenceLine(macroEnv, preferCdi ? 'CDI' : 'SELIC');

    const debt = isToolSuccess(debtEnv) ? debtEnv.data : null;
    const debtFailedNote = !debt
      ? `Não foi possível obter a carteira de dívidas reais (${debtEnv?.error || 'ferramenta sem dados'}). Nenhum valor de exposição foi presumido.`
      : null;

    let effectiveCurrentRate = rateParams.currentRatePct;
    let effectiveTargetRate = rateParams.targetRatePct;

    if (effectiveTargetRate === undefined && rateParams.shockPp !== undefined) {
      if (macroRef.indicator && isPlausibleInterestRate(macroRef.indicator.value)) {
        effectiveCurrentRate = macroRef.indicator.value;
        effectiveTargetRate = Number((macroRef.indicator.value + rateParams.shockPp).toFixed(2));
      }
    }

    const simulationRequested = effectiveTargetRate !== undefined;
    let simEnv: any = null;
    if (simulationRequested) {
      simEnv = await invokeTool('simulate_interest_rate_scenario', {
        targetSelicPct: effectiveTargetRate,
        ...(effectiveCurrentRate !== undefined ? { currentSelicPct: effectiveCurrentRate } : {}),
      });
    }

    const sim = simulationRequested && isToolSuccess(simEnv) ? simEnv.data : null;

    sections.push(
      `#### Fatos Observados`,
      `- **Empresa:** ${compName} (${regimeLabel}) | Período: ${periodLabel}`
    );

    if (debt) {
      sections.push(
        `- **Endividamento Total Monitorado:** R$ ${Number(debt.totalOutstandingDebt || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `- **Parcela Exposta a Juros Pós-Fixados (SELIC/CDI):** R$ ${Number(debt.floatingRateDebt || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${debt.floatingSharePct ?? '0'}% do total considerando pós-fixadas).`,
        `- **Parcela Pré-Fixada / IPCA (Imune no Curto Prazo):** R$ ${Number(debt.fixedRateDebt || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
      );
    } else if (debtFailedNote) {
      sections.push(`- **Carteira de Dívidas:** ${debtFailedNote}`);
    }

    sections.push(`- **Referência Macroeconômica:** ${macroRef.line}`);

    if (rateParams.ignoredShareMentions.length > 0) {
      sections.push(
        `- **Nota de Interpretação:** Percentuais de composição/indexação mencionados na pergunta (${rateParams.ignoredShareMentions.join(', ')}) não foram tratados como taxa de juros; os cálculos utilizam os contratos reais cadastrados na empresa.`
      );
    }

    sections.push(``);

    if (simulationRequested) {
      if (sim) {
        sections.push(
          `#### Estimativa Determinística (Taxa ${sim.currentSelicPct}% → ${sim.targetSelicPct}% a.a.)`,
          `- **Exposição Pós-Fixada Considerada na Simulação:** R$ ${Number(sim.exposedFloatingDebt || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          `- **Parcela Imune na Simulação (Pré-Fixada / IPCA):** R$ ${Number(sim.unaffectedFixedOrIpcaDebt || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          `- **Impacto Anual Estimado em Juros:** R$ ${Number(sim.annualizedInterestImpact || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/ano`,
          `- **Impacto no Lucro Líquido Mensal:** Δ R$ ${Number(sim.netProfitDiff || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês (Lucro vai de R$ ${Number(sim.baseNetProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para R$ ${Number(sim.simulatedNetProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`,
          `- **Tratamento Tributário (${sim.taxRegime || regimeLabel}):** ${sim.taxMethodologyNote || 'Conforme regime da empresa.'}`
        );
      } else {
        sections.push(
          `#### Simulação Não Executada (Falha Controlada)`,
          `- Não foi possível calcular a simulação determinística de juros: ${simEnv?.error || 'a ferramenta de simulação retornou erro ou resposta sem dados.'}`,
          `- Nenhum impacto financeiro foi estimado ou inventado na ausência do resultado da ferramenta.`
        );
      }
    } else if (rateParams.shockPp !== undefined) {
      sections.push(
        `#### Simulação Não Executada (Dados Macroeconômicos Ausentes)`,
        `- Foi identificado um choque relativo de ${rateParams.shockPp > 0 ? '+' : ''}${rateParams.shockPp} p.p., porém não há taxa base oficial disponível na ferramenta macroeconômica para calcular a taxa-alvo sem inventar premissas.`
      );
    } else {
      sections.push(
        `#### Análise de Exposição (Sem Taxa-Alvo Explícita na Pergunta)`,
        `- Nenhuma taxa de juros alvo ou variação em pontos percentuais foi especificada na pergunta, portanto nenhuma simulação arbitrária foi executada.`,
        `- Dívidas **pré-fixadas** permanecem imunes a choques de Selic/CDI no curto prazo, enquanto contratos **pós-fixados (CDI/Selic)** refletem diretamente alterações na taxa básica conforme seu peso real na carteira.`
      );
      if (macroRef.isMissingOrOutdated) {
        sections.push(
          `- **Alerta de Dados Macro:** A taxa oficial está ausente ou em cache local não sincronizado; recomenda-se sincronizar os indicadores BCB/IBGE antes de simular cenários.`
        );
      }
    }

    const simLimitations = Array.isArray(sim?.limitations) ? sim.limitations : [];
    const extraLimitations: string[] = [];
    if (macroRef.isMissingOrOutdated) {
      extraLimitations.push('Série macroeconômica ausente ou baseada em cache local de referência (não sincronizada ao vivo nesta consulta).');
    }
    if (simLimitations.length > 0 || extraLimitations.length > 0) {
      sections.push(``, `#### Limitações`, ...simLimitations.map((l: string) => `- ${l}`), ...extraLimitations.map(l => `- ${l}`));
    }
    return sections.join('\n');
  }

  // Detect revenue / sales drop / price / demand simulation
  if (q.includes('cair') || q.includes('queda') || q.includes('preco') || q.includes('demanda') || q.includes('venda')) {
    const compPeriodEnv = await invokeTool('compare_financial_periods', {});
    const pctMatch = q.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const pctVal = pctMatch ? parseBrDecimal(pctMatch[1]) : 10;
    const isDrop = q.includes('cair') || q.includes('queda') || q.includes('reduz');
    const signedPct = isDrop ? -Math.abs(pctVal) : pctVal;

    const simEnv = q.includes('preco')
      ? await invokeTool('simulate_price_scenario', { priceChangePercent: signedPct })
      : await invokeTool('simulate_revenue_scenario', { revenueChangePercent: signedPct, driver: 'VOLUME' });

    const sim = isToolSuccess(simEnv) ? simEnv.data : null;
    const compData = isToolSuccess(compPeriodEnv) ? compPeriodEnv.data : null;

    sections.push(
      `#### Fatos Observados`,
      `- **Receita Líquida Atual (${periodLabel}):** R$ ${Number(ctx?.dre?.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Margem de Contribuição Atual:** ${ctx?.indicators?.contributionMarginRatio ?? 'N/A'}% | **Lucro Líquido:** R$ ${Number(ctx?.dre?.netProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      compData?.comparable
        ? `- **Variação vs Período Anterior (${compData.comparison.baseLabel}):** Receita Líquida ${compData.comparison.metrics.netRevenue.percentChange}% | Lucro Líquido ${compData.comparison.metrics.netProfit.percentChange}%.`
        : `- **Comparação de Período:** ${compData?.message || compPeriodEnv?.error || 'Apenas 1 período disponível.'}`,
      ``
    );

    if (sim) {
      sections.push(
        `#### Simulação Determinística (${signedPct > 0 ? '+' : ''}${signedPct}%)`,
        `- **Nova Receita Líquida:** R$ ${Number(sim.simulatedNetRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `- **Impacto no Resultado Operacional:** R$ ${Number(sim.operatingResultDiff || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `- **Novo Lucro Líquido Gerencial:** R$ ${Number(sim.simulatedNetProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Δ R$ ${Number(sim.netProfitDiff || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
        ``,
        `#### Hipóteses a Investigar`,
        `- Oscilações de faturamento no varejo de vestuário podem decorrer de menor tráfego/demanda, aumento de descontos promocionais ou ruptura de estoque em tamanhos/itens-chave.`
      );
    } else {
      sections.push(
        `#### Simulação Não Executada (Falha Controlada)`,
        `- Não foi possível simular a variação de receita/preço: ${simEnv?.error || 'ferramenta sem dados.'}`
      );
    }
    return sections.join('\n');
  }

  // Detect textile & apparel sector questions
  if (
    q.includes('algodao') ||
    q.includes('materia-prima') ||
    q.includes('materia prima') ||
    q.includes('insumo') ||
    q.includes('cambio') ||
    q.includes('dolar') ||
    q.includes('colecao') ||
    q.includes('textil') ||
    q.includes('vestuario') ||
    q.includes('tributar') ||
    q.includes('importad') ||
    q.includes('monitorar') ||
    q.includes('expost')
  ) {
    const macroEnv = await invokeTool('get_macro_indicators', {});
    const debtEnv = await invokeTool('get_debt_exposure', {});
    const missingEnv = await invokeTool('identify_missing_information', {});
    const memEnv = await invokeTool('query_operational_memory', {});
    const pctMatch = q.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const shockPct = pctMatch ? parseBrDecimal(pctMatch[1]) : 10;

    const simCostEnv = await invokeTool('simulate_combined_scenario', {
      variableCostChangePercent: shockPct,
      priceChangePercent: 0,
      demandChangePercent: 0,
    });

    const simCost = isToolSuccess(simCostEnv) ? simCostEnv.data : null;
    const debtData = isToolSuccess(debtEnv) ? debtEnv.data : null;
    const missingData = isToolSuccess(missingEnv) ? missingEnv.data : null;
    const memItems = isToolSuccess(memEnv) && Array.isArray(memEnv.data?.items) ? memEnv.data.items : [];

    const savedTextilePlans = memItems.filter(
      (m: any) => m.memoryType === 'RISK_ALERT' || /t[eê]xtil|algod|cole[cç]|c[aâ]mbio/i.test(m.title || '')
    );

    const macroArray = isToolSuccess(macroEnv) && Array.isArray(macroEnv.data) ? macroEnv.data : [];
    const ptaxMacro = macroArray.find((m: any) => m.code === 'PTAX');
    const selicMacro = macroArray.find((m: any) => m.code === 'SELIC');

    const radarTopic = q.includes('tributar') || q.includes('importad')
      ? 'TRIBUTACAO_IMPORTADOS'
      : q.includes('colecao') || q.includes('clima') || q.includes('estoque')
      ? 'CLIMA_ESTOQUES'
      : 'INSUMOS_CAMBIO';

    const radar = await fetchTextileSectorNewsRadar({
      topic: radarTopic,
      companySnapshot: {
        companyId: profileData?.id,
        companyName: compName,
        industry: profileData?.industry,
        taxRegime: profileData?.taxRegime,
        periodLabel: ctx?.period,
        netRevenue: ctx?.dre?.netRevenue,
        cmv: ctx?.dre?.cmv,
        variableExpenses: ctx?.dre?.variableExpenses,
        contributionMargin: ctx?.dre?.contributionMargin,
        contributionMarginPercentage: ctx?.indicators?.contributionMarginRatio,
        fixedExpenses: ctx?.dre?.fixedExpenses,
        operatingResult: ctx?.dre?.operatingResult,
        operatingResultPercentage: ctx?.indicators?.operatingMargin,
        netProfit: ctx?.dre?.netProfit,
        netProfitPercentage: ctx?.indicators?.netMargin,
        safetyMargin: ctx?.dre?.safetyMargin,
        floatingRateDebt: Number(debtData?.floatingRateDebt || 0),
        floatingSharePct: debtData?.floatingSharePct,
      },
      macroSummary: macroArray,
      aiClientOverride: null,
    });

    const primaryAlert = radar.newsAlerts[0];

    sections.push(
      `#### 1. Fatos Confirmados (DRE Auditada & Indicadores Oficiais)`,
      `- **Empresa:** ${compName} (${regimeLabel}) | **Período:** ${periodLabel}`,
      `- **Receita Líquida:** R$ ${Number(ctx?.dre?.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | **CMV Atual:** R$ ${Number(ctx?.dre?.cmv || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | **Despesas Variáveis:** R$ ${Number(ctx?.dre?.variableExpenses || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Margem de Contribuição:** R$ ${Number(ctx?.dre?.contributionMargin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${ctx?.indicators?.contributionMarginRatio ?? 'N/A'}%) | **Lucro Líquido:** R$ ${Number(ctx?.dre?.netProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${ctx?.indicators?.netMargin ?? 'N/A'}%)`,
      `- **Câmbio PTAX Oficial:** ${ptaxMacro ? `R$ ${ptaxMacro.value} (ref. ${ptaxMacro.referenceDate || 'BCB'})` : 'Indisponível'} | **Selic:** ${selicMacro ? `${selicMacro.value}% a.a.` : 'Indisponível'}`,
      primaryAlert ? `- **Contexto Setorial (${primaryAlert.category}):** ${primaryAlert.confirmedFact}` : '',
      ``,
      `#### 2. Consequência Econômica para o Setor Têxtil & Vestuário`,
      `- ${primaryAlert?.sectorEconomicEffect || 'Oscilações em algodão, fibras sintéticas, câmbio e tributação comprimem a margem bruta de confecções e varejistas que não travam compras antecipadamente.'}`,
      ``,
      simCost
        ? `#### 3. Impacto Específico Estimado na Empresa (Motor Determinístico Decimal.js — Hipótese de +${shockPct}% nos Custos Variáveis)\n- **CMV Simulado (+${shockPct}%):** R$ ${Number(simCost.simulatedCmv || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (ante R$ ${Number(simCost.baseCmv || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} na base)\n- **Nova Margem de Contribuição:** R$ ${Number(simCost.simulatedContributionMargin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- **Impacto no Resultado Operacional e Lucro Líquido:** Δ R$ ${Number(simCost.netProfitDiff || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês (Lucro Líquido vai de R$ ${Number(simCost.baseNetProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para R$ ${Number(simCost.simulatedNetProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`
        : `#### 3. Simulação de Custos Variáveis Indisponível\n- Não foi possível simular o choque de custos variáveis: ${simCostEnv?.error || 'ferramenta sem dados.'}`,
      ``,
      `#### 4. Custos a Monitorar e O Que Fazer Antes da Próxima Coleção`,
      ...(primaryAlert?.howToPrepare || []).map((step: string) => `- **Ação Recomendada:** ${step}`),
      `- **Indicadores Críticos a Monitorar:** ${(primaryAlert?.monitoredIndicators || ['CMV / Receita Líquida (%)', 'Margem de Contribuição (%)', 'Giro de Estoque (dias)']).join(', ')}.`,
      ...(savedTextilePlans.length > 0
        ? [
            ``,
            `#### 5. Planos Setoriais Registrados na Memória Operacional da Empresa (${savedTextilePlans.length})`,
            ...savedTextilePlans.slice(0, 3).map((p: any) => `- **${p.title}:** ${p.summary}`),
          ]
        : []),
      ``,
      `#### 6. Dados Ausentes e Limitações (Transparência Analítica)`,
      ...(primaryAlert?.missingCompanyData || []).map((m: string) => `- ${m}`),
      ...(missingData?.missingFields?.slice(0, 3).map((m: any) => `- **${m.field}:** ${m.impact}`) || [])
    );
    return sections.filter(Boolean).join('\n');
  }

  // Detect missing information / working capital inquiry
  if (q.includes('falta') || q.includes('ausent') || q.includes('capital de giro') || q.includes('incompleto')) {
    const missingEnv = await invokeTool('identify_missing_information', {});
    const cashEnv = await invokeTool('get_cash_flow_context', {});
    const missing = isToolSuccess(missingEnv) ? missingEnv.data : null;
    const cashData = isToolSuccess(cashEnv) ? cashEnv.data : null;

    if (!missing) {
      sections.push(
        `#### Dados de Completude Indisponíveis`,
        `- Não foi possível avaliar os campos ausentes: ${missingEnv?.error || 'ferramenta sem dados.'}`
      );
      return sections.join('\n');
    }

    sections.push(
      `#### Completude dos Dados (${missing.period || periodLabel})`,
      `- **Grau de Completude:** ${missing.completenessPct ?? 'N/A'}%`,
      `- **Ciclo Financeiro Atual:** ${cashData?.cashConversionCycle ? `${cashData.cashConversionCycle} dias` : 'Não calculável devido a campos ausentes.'}`,
      ``,
      `#### Informações Ausentes e Impactos`,
      ...(Array.isArray(missing.missingFields) && missing.missingFields.length > 0
        ? missing.missingFields.map((m: any) => `- **${m.field}** (${m.category}): ${m.impact}`)
        : ['- Todos os campos principais da DRE e Balanço foram informados.'])
    );
    return sections.join('\n');
  }

  // Detect period comparison
  if (q.includes('compar') || q.includes('evolu') || q.includes('ultimos dois')) {
    const compEnv = await invokeTool('compare_financial_periods', {});
    const compData = isToolSuccess(compEnv) ? compEnv.data : null;
    if (compData?.comparable && compData.comparison) {
      const c = compData.comparison;
      sections.push(
        `#### Comparação Entre Períodos (${c.baseLabel} → ${c.targetLabel})`,
        `- **Receita Líquida:** R$ ${Number(c.metrics.netRevenue.previous).toLocaleString('pt-BR')} → R$ ${Number(c.metrics.netRevenue.current).toLocaleString('pt-BR')} (${c.metrics.netRevenue.percentChange}%)`,
        `- **Margem de Contribuição:** ${c.metrics.contributionMarginPercentage.previous}% → ${c.metrics.contributionMarginPercentage.current}%`,
        `- **Resultado Operacional:** R$ ${Number(c.metrics.operatingResult.previous).toLocaleString('pt-BR')} → R$ ${Number(c.metrics.operatingResult.current).toLocaleString('pt-BR')} (${c.metrics.operatingResult.percentChange}%)`,
        `- **Lucro Líquido:** R$ ${Number(c.metrics.netProfit.previous).toLocaleString('pt-BR')} → R$ ${Number(c.metrics.netProfit.current).toLocaleString('pt-BR')} (${c.metrics.netProfit.percentChange}%)`
      );
    } else {
      sections.push(compData?.message || compEnv?.error || 'Histórico insuficiente para comparação.');
    }
    return sections.join('\n');
  }

  // Detect executive report request
  if (q.includes('relatorio') || q.includes('report')) {
    const repEnv = await invokeTool('generate_executive_report', {});
    const rep = isToolSuccess(repEnv) ? repEnv.data : null;
    if (!rep) {
      sections.push(
        `#### Relatório Executivo Indisponível`,
        `- Não foi possível gerar o relatório executivo: ${repEnv?.error || 'ferramenta sem dados.'}`
      );
      return sections.join('\n');
    }
    sections.push(
      `#### Relatório Executivo Gerado (${rep.periodRef || periodLabel} · ${rep.dataVersionRef || 'Atual'})`,
      rep.summary || '',
      ``,
      `**Riscos Identificados:** ${rep.risks?.length || 0} | **Campos Ausentes:** ${rep.missingData?.length || 0}`
    );
    return sections.join('\n');
  }

  // Default comprehensive health & risk check
  const risksEnv = await invokeTool('identify_financial_risks', {});
  const missingEnv = await invokeTool('identify_missing_information', {});
  const actionsEnv = await invokeTool('prioritize_management_actions', {});

  const risksData = isToolSuccess(risksEnv) ? risksEnv.data : null;
  const missingData = isToolSuccess(missingEnv) ? missingEnv.data : null;
  const actionsData = isToolSuccess(actionsEnv) ? actionsEnv.data : null;

  sections.push(
    `#### Fatos Observados (${periodLabel})`,
    ctx
      ? `- **Receita Líquida:** R$ ${Number(ctx?.dre?.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- **Margem de Contribuição:** ${ctx?.indicators?.contributionMarginRatio ?? 'N/A'}% | **Margem Líquida:** ${ctx?.indicators?.netMargin ?? 'N/A'}%\n- **Resultado Operacional Gerencial de Caixa:** R$ ${Number(ctx?.dre?.operatingResult || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n- **Ponto de Equilíbrio Operacional:** R$ ${Number(ctx?.dre?.operatingBreakEven || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Margem de Segurança: ${ctx?.dre?.safetyMargin ?? 'N/A'}%)`
      : `- Contexto financeiro indisponível (${contextEnv?.error || 'sem dados cadastrados'}).`,
    ``,
    `#### Principais Riscos`,
    ...(risksData?.risks?.length > 0
      ? risksData.risks.map((r: any) => `- **[${r.severity}] ${r.category}:** ${r.indicator} — ${r.detail}`)
      : [risksData ? '- Nenhum risco crítico disparado pelos parâmetros atuais.' : `- Não foi possível apurar riscos (${risksEnv?.error || 'ferramenta sem dados'}).`]),
    ``,
    `#### Ações Prioritárias`,
    ...(actionsData?.actions?.length > 0
      ? actionsData.actions.map((a: any) => `- **${a.priority}. [${a.horizon}]** ${a.action} (${a.justification})`)
      : [`- Ações prioritárias indisponíveis (${actionsEnv?.error || 'nenhuma ação retornada'}).`]),
    ``,
    `#### Dados Ausentes (${missingData?.completenessPct ?? 'N/A'}% de completude)`,
    ...(missingData?.missingFields?.length > 0
      ? missingData.missingFields.slice(0, 4).map((m: any) => `- ${m.field}: ${m.impact}`)
      : [missingData ? '- Dados completos.' : `- Verificação de completude indisponível (${missingEnv?.error || 'ferramenta sem dados'}).`])
  );

  return sections.join('\n');
}

