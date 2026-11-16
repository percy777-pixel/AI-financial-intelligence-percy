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

/**
 * Deterministic multi-tool orchestrator for LOCAL_FALLBACK mode (without external LLM).
 * Still calls real backend tools & Decimal.js financial engine; clearly labeled as Fallback Local.
 */
async function runLocalDeterministicAgentPlan(
  question: string,
  invokeTool: (name: string, args: any) => Promise<ToolExecutionEnvelope>
): Promise<string> {
  const q = question.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const profileEnv = await invokeTool('get_company_profile', {});
  const contextEnv = await invokeTool('get_financial_context', {});
  const sections: string[] = [
    `### Resposta Executiva (Modo Fallback Local — Roteador Determinístico de Ferramentas)`,
    `> *Nota de transparência: Executado sem síntese generativa externa (GEMINI_API_KEY não configurada ou indisponível). Todos os números abaixo foram apurados pelas ferramentas determinísticas do backend.*`,
    ``,
  ];

  const compName = profileEnv.data?.name || 'Empresa';
  const ctx = contextEnv.data;

  // Detect Selic / interest rate shock question (e.g. "selic de 13% para 15%" or "juros")
  if (q.includes('selic') || q.includes('juro') || q.includes('cdi') || q.includes('endivid')) {
    const debtEnv = await invokeTool('get_debt_exposure', {});
    const macroEnv = await invokeTool('get_macro_indicators', {});
    // Extract target Selic if mentioned (e.g., "para 15" or "15%")
    const matches = [...q.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m => Number(m[1].replace(',', '.')));
    const targetSelic = matches.length >= 2 ? matches[1] : matches.length === 1 ? matches[0] : 15;
    const currentSelic = matches.length >= 2 ? matches[0] : undefined;

    const simEnv = await invokeTool('simulate_interest_rate_scenario', {
      targetSelicPct: targetSelic,
      ...(currentSelic !== undefined ? { currentSelicPct: currentSelic } : {}),
    });

    const sim = simEnv.data;
    const debt = debtEnv.data;
    const selicMacro = Array.isArray(macroEnv.data) ? macroEnv.data.find((m: any) => m.code === 'SELIC') : null;

    sections.push(
      `#### Fatos Observados`,
      `- **Empresa:** ${compName} (${profileEnv.data?.taxRegime}) | Período: ${ctx?.period}`,
      `- **Endividamento Total Monitorado:** R$ ${Number(debt.totalOutstandingDebt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Parcela Exposta a Juros Pós-Fixados (SELIC/CDI):** R$ ${Number(sim.exposedFloatingDebt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${debt.floatingSharePct}% do total considerando pós-fixadas).`,
      `- **Parcela Pré-Fixada / Imune no Curto Prazo:** R$ ${Number(sim.unaffectedFixedOrIpcaDebt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
      `- **Selic Oficial em Base:** ${selicMacro?.value ?? 'N/A'}% a.a. (${selicMacro?.source || 'BCB'}).`,
      ``,
      `#### Estimativa Determinística (Selic ${sim.currentSelicPct}% → ${sim.targetSelicPct}% a.a.)`,
      `- **Impacto Anual Estimado em Juros:** R$ ${Number(sim.annualizedInterestImpact).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/ano`,
      `- **Impacto no Lucro Líquido Mensal:** Δ R$ ${Number(sim.netProfitDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês (Lucro vai de R$ ${Number(sim.baseNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para R$ ${Number(sim.simulatedNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`,
      ``,
      `#### Limitações`,
      ...(sim.limitations || []).map((l: string) => `- ${l}`)
    );
    return sections.join('\n');
  }

  // Detect revenue / sales drop / price / demand simulation
  if (q.includes('cair') || q.includes('queda') || q.includes('preco') || q.includes('demanda') || q.includes('venda')) {
    const compPeriodEnv = await invokeTool('compare_financial_periods', {});
    const pctMatch = q.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const pctVal = pctMatch ? Number(pctMatch[1].replace(',', '.')) : 10;
    const isDrop = q.includes('cair') || q.includes('queda') || q.includes('reduz');
    const signedPct = isDrop ? -Math.abs(pctVal) : pctVal;

    const simEnv = q.includes('preco')
      ? await invokeTool('simulate_price_scenario', { priceChangePercent: signedPct })
      : await invokeTool('simulate_revenue_scenario', { revenueChangePercent: signedPct, driver: 'VOLUME' });

    const sim = simEnv.data;
    sections.push(
      `#### Fatos Observados`,
      `- **Receita Líquida Atual (${ctx?.period}):** R$ ${Number(ctx?.dre?.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Margem de Contribuição Atual:** ${ctx?.indicators?.contributionMarginRatio}% | **Lucro Líquido:** R$ ${Number(ctx?.dre?.netProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      compPeriodEnv.data?.comparable
        ? `- **Variação vs Período Anterior (${compPeriodEnv.data.comparison.baseLabel}):** Receita Líquida ${compPeriodEnv.data.comparison.metrics.netRevenue.percentChange}% | Lucro Líquido ${compPeriodEnv.data.comparison.metrics.netProfit.percentChange}%.`
        : `- **Comparação de Período:** ${compPeriodEnv.data?.message || 'Apenas 1 período disponível.'}`,
      ``,
      `#### Simulação Determinística (${signedPct > 0 ? '+' : ''}${signedPct}%)`,
      `- **Nova Receita Líquida:** R$ ${Number(sim.simulatedNetRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Impacto no Resultado Operacional:** R$ ${Number(sim.operatingResultDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Novo Lucro Líquido Gerencial:** R$ ${Number(sim.simulatedNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Δ R$ ${Number(sim.netProfitDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      ``,
      `#### Hipóteses a Investigar`,
      `- Oscilações de faturamento no varejo de vestuário podem decorrer de menor tráfego/demanda, aumento de descontos promocionais ou ruptura de estoque em tamanhos/itens-chave.`
    );
    return sections.join('\n');
  }

  // Detect textile & apparel sector questions (algodão, matéria-prima, câmbio/dólar, coleção, reforma tributária, importados, custos a monitorar)
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
    const shockPct = pctMatch ? Number(pctMatch[1].replace(',', '.')) : 10;

    // Run deterministic simulation for +shockPct% variable cost (Case A/B: cotton/exchange rate)
    const simCostEnv = await invokeTool('simulate_combined_scenario', {
      variableCostChangePercent: shockPct,
      priceChangePercent: 0,
      demandChangePercent: 0,
    });

    const simCost = simCostEnv.data;
    const savedTextilePlans = (memEnv.data?.items || []).filter(
      (m: any) => m.memoryType === 'RISK_ALERT' || /t[eê]xtil|algod|cole[cç]|c[aâ]mbio/i.test(m.title || '')
    );

    const ptaxMacro = Array.isArray(macroEnv.data) ? macroEnv.data.find((m: any) => m.code === 'PTAX') : null;
    const selicMacro = Array.isArray(macroEnv.data) ? macroEnv.data.find((m: any) => m.code === 'SELIC') : null;

    const radarTopic = q.includes('tributar') || q.includes('importad')
      ? 'TRIBUTACAO_IMPORTADOS'
      : q.includes('colecao') || q.includes('clima') || q.includes('estoque')
      ? 'CLIMA_ESTOQUES'
      : 'INSUMOS_CAMBIO';

    const radar = await fetchTextileSectorNewsRadar({
      topic: radarTopic,
      companySnapshot: {
        companyId: profileEnv.data?.id,
        companyName: compName,
        industry: profileEnv.data?.industry,
        taxRegime: profileEnv.data?.taxRegime,
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
        floatingRateDebt: Number(debtEnv.data?.floatingRateDebt || 0),
        floatingSharePct: debtEnv.data?.floatingSharePct,
      },
      macroSummary: Array.isArray(macroEnv.data) ? macroEnv.data : [],
      aiClientOverride: null,
    });

    const primaryAlert = radar.newsAlerts[0];

    sections.push(
      `#### 1. Fatos Confirmados (DRE Auditada & Indicadores Oficiais)`,
      `- **Empresa:** ${compName} (${profileEnv.data?.taxRegime}) | **Período:** ${ctx?.period}`,
      `- **Receita Líquida:** R$ ${Number(ctx?.dre?.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | **CMV Atual:** R$ ${Number(ctx?.dre?.cmv || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | **Despesas Variáveis:** R$ ${Number(ctx?.dre?.variableExpenses || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Margem de Contribuição:** R$ ${Number(ctx?.dre?.contributionMargin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${ctx?.indicators?.contributionMarginRatio}%) | **Lucro Líquido:** R$ ${Number(ctx?.dre?.netProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${ctx?.indicators?.netMargin}%)`,
      `- **Câmbio PTAX Oficial:** R$ ${ptaxMacro?.value ?? 'N/A'} (ref. ${ptaxMacro?.referenceDate || 'BCB'}) | **Selic:** ${selicMacro?.value ?? 'N/A'}% a.a.`,
      primaryAlert ? `- **Contexto Setorial (${primaryAlert.category}):** ${primaryAlert.confirmedFact}` : '',
      ``,
      `#### 2. Consequência Econômica para o Setor Têxtil & Vestuário`,
      `- ${primaryAlert?.sectorEconomicEffect || 'Oscilações em algodão, fibras sintéticas, câmbio e tributação comprimem a margem bruta de confecções e varejistas que não travam compras antecipadamente.'}`,
      ``,
      `#### 3. Impacto Específico Estimado na Empresa (Motor Determinístico Decimal.js — Hipótese de +${shockPct}% nos Custos Variáveis)`,
      `- **CMV Simulado (+${shockPct}%):** R$ ${Number(simCost.simulatedCmv).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (ante R$ ${Number(simCost.baseCmv).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} na base)`,
      `- **Nova Margem de Contribuição:** R$ ${Number(simCost.simulatedContributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `- **Impacto no Resultado Operacional e Lucro Líquido:** Δ R$ ${Number(simCost.netProfitDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês (Lucro Líquido vai de R$ ${Number(simCost.baseNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} para R$ ${Number(simCost.simulatedNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
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
      ...(missingEnv.data?.missingFields?.slice(0, 3).map((m: any) => `- **${m.field}:** ${m.impact}`) || [])
    );
    return sections.filter(Boolean).join('\n');
  }

  // Detect missing information / working capital inquiry
  if (q.includes('falta') || q.includes('ausent') || q.includes('capital de giro') || q.includes('incompleto')) {
    const missingEnv = await invokeTool('identify_missing_information', {});
    const cashEnv = await invokeTool('get_cash_flow_context', {});
    const missing = missingEnv.data;
    sections.push(
      `#### Completude dos Dados (${missing.period})`,
      `- **Grau de Completude:** ${missing.completenessPct}%`,
      `- **Ciclo Financeiro Atual:** ${cashEnv.data?.cashConversionCycle ? `${cashEnv.data.cashConversionCycle} dias` : 'Não calculável devido a campos ausentes.'}`,
      ``,
      `#### Informações Ausentes e Impactos`,
      ...(missing.missingFields?.length > 0
        ? missing.missingFields.map((m: any) => `- **${m.field}** (${m.category}): ${m.impact}`)
        : ['- Todos os campos principais da DRE e Balanço foram informados.'])
    );
    return sections.join('\n');
  }

  // Detect period comparison
  if (q.includes('compar') || q.includes('evolu') || q.includes('ultimos dois')) {
    const compEnv = await invokeTool('compare_financial_periods', {});
    if (compEnv.data?.comparable) {
      const c = compEnv.data.comparison;
      sections.push(
        `#### Comparação Entre Períodos (${c.baseLabel} → ${c.targetLabel})`,
        `- **Receita Líquida:** R$ ${Number(c.metrics.netRevenue.previous).toLocaleString('pt-BR')} → R$ ${Number(c.metrics.netRevenue.current).toLocaleString('pt-BR')} (${c.metrics.netRevenue.percentChange}%)`,
        `- **Margem de Contribuição:** ${c.metrics.contributionMarginPercentage.previous}% → ${c.metrics.contributionMarginPercentage.current}%`,
        `- **Resultado Operacional:** R$ ${Number(c.metrics.operatingResult.previous).toLocaleString('pt-BR')} → R$ ${Number(c.metrics.operatingResult.current).toLocaleString('pt-BR')} (${c.metrics.operatingResult.percentChange}%)`,
        `- **Lucro Líquido:** R$ ${Number(c.metrics.netProfit.previous).toLocaleString('pt-BR')} → R$ ${Number(c.metrics.netProfit.current).toLocaleString('pt-BR')} (${c.metrics.netProfit.percentChange}%)`
      );
    } else {
      sections.push(compEnv.data?.message || 'Histórico insuficiente para comparação.');
    }
    return sections.join('\n');
  }

  // Detect executive report request
  if (q.includes('relatorio') || q.includes('report')) {
    const repEnv = await invokeTool('generate_executive_report', {});
    sections.push(
      `#### Relatório Executivo Gerado (${repEnv.data?.periodRef} · ${repEnv.data?.dataVersionRef})`,
      repEnv.data?.summary || '',
      ``,
      `**Riscos Identificados:** ${repEnv.data?.risks?.length || 0} | **Campos Ausentes:** ${repEnv.data?.missingData?.length || 0}`
    );
    return sections.join('\n');
  }

  // Default comprehensive health & risk check
  const risksEnv = await invokeTool('identify_financial_risks', {});
  const missingEnv = await invokeTool('identify_missing_information', {});
  const actionsEnv = await invokeTool('prioritize_management_actions', {});

  sections.push(
    `#### Fatos Observados (${ctx?.period})`,
    `- **Receita Líquida:** R$ ${Number(ctx?.dre?.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `- **Margem de Contribuição:** ${ctx?.indicators?.contributionMarginRatio}% | **Margem Líquida:** ${ctx?.indicators?.netMargin}%`,
    `- **Resultado Operacional Gerencial de Caixa:** R$ ${Number(ctx?.dre?.operatingResult || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `- **Ponto de Equilíbrio Operacional:** R$ ${Number(ctx?.dre?.operatingBreakEven || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Margem de Segurança: ${ctx?.dre?.safetyMargin}%)`,
    ``,
    `#### Principais Riscos`,
    ...(risksEnv.data?.risks?.length > 0
      ? risksEnv.data.risks.map((r: any) => `- **[${r.severity}] ${r.category}:** ${r.indicator} — ${r.detail}`)
      : ['- Nenhum risco crítico disparado pelos parâmetros atuais.']),
    ``,
    `#### Ações Prioritárias`,
    ...(actionsEnv.data?.actions || []).map((a: any) => `- **${a.priority}. [${a.horizon}]** ${a.action} (${a.justification})`),
    ``,
    `#### Dados Ausentes (${missingEnv.data?.completenessPct}% de completude)`,
    ...(missingEnv.data?.missingFields?.slice(0, 4).map((m: any) => `- ${m.field}: ${m.impact}`) || ['- Dados completos.'])
  );

  return sections.join('\n');
}
