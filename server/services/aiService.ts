import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const GEMINI_MODEL = 'gemini-4-hydrogen';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.8-flash';
export const GEMINI_TERTIARY_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_GEMINI_TIMEOUT_MS = 25000;

// In-memory cooldown tracker to avoid hammering models whose quota is temporarily exhausted
const modelCooldownUntil = new Map<string, number>();

export function clearGeminiCooldownsForTesting(): void {
  modelCooldownUntil.clear();
}

export function isModelOnCooldown(model: string): boolean {
  const until = modelCooldownUntil.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldownUntil.delete(model);
    return false;
  }
  return true;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationLabel = 'Gemini API'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutErr: any = new Error(`TIMEOUT: ${operationLabel} excedeu o tempo limite de ${timeoutMs}ms.`);
      timeoutErr.status = 408;
      timeoutErr.isTimeout = true;
      reject(timeoutErr);
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function sanitizeAiErrorMessage(raw: unknown): string {
  const msg = String((raw as any)?.message || raw || 'Erro desconhecido na API Gemini');
  return msg
    .replace(/AIza[A-Za-z0-9_-]{25,}/g, '[CHAVE_OCULTADA]')
    .replace(/(key|apiKey|api_key|token|secret)\s*[:=]\s*[^\s&"',}]+/gi, '$1=[OCULTADO]');
}

export function classifyAndRecordGeminiError(model: string, err: any): {
  isQuota: boolean;
  isAuth: boolean;
  isTimeout: boolean;
  isInvalidResponse: boolean;
  userMessage: string;
} {
  const rawMsg = sanitizeAiErrorMessage(err);
  const isTimeout =
    Boolean(err?.isTimeout) ||
    err?.status === 408 ||
    /TIMEOUT|timed out|AbortError/i.test(rawMsg);
  const isInvalidResponse =
    Boolean(err?.isInvalidResponse) ||
    /INVALID_MODEL_RESPONSE|Unexpected token|JSON/i.test(rawMsg);
  const isQuota =
    err?.status === 429 ||
    /429|RESOURCE_EXHAUSTED|Quota exceeded|rate-limit/i.test(rawMsg);
  const isAuth =
    err?.status === 400 ||
    err?.status === 403 ||
    /API_KEY_INVALID|PERMISSION_DENIED/i.test(rawMsg);

  if (isQuota) {
    // Cooldown for 60 seconds on rate-limit to prevent repeated 429 noise
    modelCooldownUntil.set(model, Date.now() + 60 * 1000);
    return {
      isQuota: true,
      isAuth: false,
      isTimeout: false,
      isInvalidResponse: false,
      userMessage:
        'Limite de taxa da API Gemini temporariamente atingido (429 RESOURCE_EXHAUSTED). Executando fallback determinístico auditável.',
    };
  }
  if (isAuth) {
    modelCooldownUntil.set(model, Date.now() + 15 * 60 * 1000);
    return {
      isQuota: false,
      isAuth: true,
      isTimeout: false,
      isInvalidResponse: false,
      userMessage:
        'Chave da API Gemini inválida ou sem permissão. Verifique Settings > Secrets. Modo determinístico local ativo.',
    };
  }
  if (isTimeout) {
    return {
      isQuota: false,
      isAuth: false,
      isTimeout: true,
      isInvalidResponse: false,
      userMessage: 'Tempo limite excedido na chamada ao modelo Gemini; executado via motor determinístico local.',
    };
  }
  if (isInvalidResponse) {
    return {
      isQuota: false,
      isAuth: false,
      isTimeout: false,
      isInvalidResponse: true,
      userMessage: 'Resposta estruturada inválida retornada pelo modelo Gemini; executado via motor determinístico local.',
    };
  }
  return {
    isQuota: false,
    isAuth: false,
    isTimeout: false,
    isInvalidResponse: false,
    userMessage: 'Modelo Gemini temporariamente indisponível; executado via motor determinístico local.',
  };
}

export function getCandidateGeminiModels(): string[] {
  const candidates = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_TERTIARY_MODEL].filter(
    m => !isModelOnCooldown(m)
  );
  return candidates;
}

export function getGeminiClient(): GoogleGenAI | null {
  if (process.env.DISABLE_EXTERNAL_AI === 'true') {
    return null;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Performs a single, low-cost, controlled validation call to the Gemini API
 * using strictly fictitious financial inputs to confirm SDK, model identifier,
 * API key, and structured JSON output without triggering mass calls.
 */
export async function validateControlledGeminiIntegration(timeoutMs = 15000): Promise<{
  configured: boolean;
  reachable: boolean;
  succeeded: boolean;
  modelUsed: string | null;
  durationMs: number;
  structuredOutputValid: boolean;
  sampleInterpretation?: string;
  error?: string;
}> {
  const started = Date.now();
  const ai = getGeminiClient();
  if (!ai) {
    return {
      configured: false,
      reachable: false,
      succeeded: false,
      modelUsed: null,
      durationMs: Date.now() - started,
      structuredOutputValid: false,
      error: 'GEMINI_API_KEY não configurada ou desabilitada.',
    };
  }

  const candidates = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_TERTIARY_MODEL];
  let lastErr = '';

  for (const modelName of candidates) {
    try {
      const response = await withTimeout<any>(
        ai.models.generateContent({
          model: modelName,
          contents:
            'Empresa Fictícia Demo Ltda (Simples Nacional): Receita Líquida R$ 100.000,00, Margem de Contribuição R$ 45.000,00 (45%), Lucro Líquido R$ 12.000,00 (12%). Gere uma interpretação executiva curta em JSON.',
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                status: { type: Type.STRING },
                interpretation: { type: Type.STRING },
                deterministicSourcePreserved: { type: Type.BOOLEAN },
              },
              required: ['status', 'interpretation', 'deterministicSourcePreserved'],
            },
          },
        }),
        timeoutMs,
        `validateControlledGeminiIntegration(${modelName})`
      );

      const text = response?.text;
      if (!text) throw new Error('Resposta vazia do modelo.');
      const parsed = JSON.parse(text);
      if (typeof parsed.interpretation === 'string' && parsed.interpretation.length > 5) {
        return {
          configured: true,
          reachable: true,
          succeeded: true,
          modelUsed: modelName,
          durationMs: Date.now() - started,
          structuredOutputValid: true,
          sampleInterpretation: parsed.interpretation,
        };
      }
    } catch (err: any) {
      lastErr = sanitizeAiErrorMessage(err);
    }
  }

  return {
    configured: true,
    reachable: false,
    succeeded: false,
    modelUsed: null,
    durationMs: Date.now() - started,
    structuredOutputValid: false,
    error: lastErr || 'Falha ao validar chamada controlada ao Gemini.',
  };
}

export interface AIAnalysisRequest {
  companyName: string;
  industry?: string;
  taxRegime?: string;
  dre: any;
  indicators: any;
  macroIndicators: any[];
  debtSummary?: any;
  periodLabel?: string;
}

export interface StructuredRecommendation {
  horizon: 'Curto Prazo (0-30 dias)' | 'Médio Prazo (30-60 dias)' | 'Estrutural (>60 dias)';
  problem: string;
  evidence: string;
  hypothesis: string;
  action: string;
  impact: string;
  confidence: string;
  missingInformation?: string;
  limitations: string;
}

export interface AIAnalysisResponse {
  provider: 'GEMINI' | 'LOCAL_FALLBACK';
  modelUsed: string;
  fallbackReason?: string;
  diagnostic: string;
  facts: string[];
  hypotheses: string[];
  estimates: string[];
  risks: Array<{ title: string; severity: 'ALTA' | 'MÉDIA' | 'BAIXA'; evidence: string; mitigation: string }>;
  missingInformation: string[];
  recommendations: StructuredRecommendation[];
  limitations: string[];
}

export async function generateFinancialDiagnosticAndRecommendations(
  reqData: AIAnalysisRequest,
  options?: { aiClientOverride?: any; timeoutMs?: number }
): Promise<AIAnalysisResponse> {
  const ai = options?.aiClientOverride !== undefined ? options.aiClientOverride : getGeminiClient();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;
  let lastNotice: string | undefined;

  if (ai) {
    const prompt = `
Você é um diretor financeiro (CFO) e analista econômico especializado em micro, pequenas e médias empresas brasileiras.
Analise os dados determinísticos auditados pelo backend abaixo para "${reqData.companyName}" (Setor: ${reqData.industry || 'Geral'}, Regime: ${reqData.taxRegime || 'Simples Nacional'}, Período: ${reqData.periodLabel || 'Atual'}):

DRE Gerencial (Calculada em Decimal.js pelo backend):
${JSON.stringify(reqData.dre, null, 2)}

Indicadores Financeiros:
${JSON.stringify(reqData.indicators, null, 2)}

Exposição a Dívidas (se disponível):
${reqData.debtSummary ? JSON.stringify(reqData.debtSummary, null, 2) : 'Não detalhada por contrato.'}

Indicadores Macroeconômicos Oficiais:
${reqData.macroIndicators.map(m => `- ${m.code} (${m.name}): ${m.value} ${m.unit} [Ref: ${m.referenceDate}, Fonte: ${m.source}]`).join('\n')}

REGRAS ESTRITAS:
1. Separe rigorosamente FATOS (comprovados diretamente pelos números acima), HIPÓTESES (explicações plausíveis que exigem verificação), ESTIMATIVAS (condicionais a premissas) e RISCOS.
2. Nunca invente números nem trate hipóteses ou correlações macroeconômicas como certezas causais.
3. No Simples Nacional, reconheça que o DAS incide sobre o faturamento (deduções) e não deve ser confundido com imposto sobre lucro.
4. Identifique explicitamente dados ausentes (ex.: capital de giro, recebíveis, estoque) e limitações da análise.
5. Não prometa resultados financeiros garantidos.
    `;

    const candidates = getCandidateGeminiModels();
    if (candidates.length === 0) {
      lastNotice =
        'Cota gratuita da API Gemini temporariamente em espera; diagnóstico gerado pelo motor determinístico local.';
    }

    for (const modelName of candidates) {
      try {
        const config: any = {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              diagnostic: { type: Type.STRING, description: 'Síntese executiva clara conectando DRE, regime tributário, capital de giro e cenário macro.' },
              facts: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Lista de fatos numéricos observados diretamente nos dados.' },
              hypotheses: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Explicações plausíveis que requerem confirmação operacional.' },
              estimates: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Estimativas condicionadas às premissas explicitadas.' },
              risks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    severity: { type: Type.STRING, description: 'ALTA, MÉDIA ou BAIXA' },
                    evidence: { type: Type.STRING },
                    mitigation: { type: Type.STRING },
                  },
                },
              },
              missingInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    horizon: { type: Type.STRING, description: 'Curto Prazo (0-30 dias) | Médio Prazo (30-60 dias) | Estrutural (>60 dias)' },
                    problem: { type: Type.STRING },
                    evidence: { type: Type.STRING },
                    hypothesis: { type: Type.STRING },
                    action: { type: Type.STRING },
                    impact: { type: Type.STRING },
                    confidence: { type: Type.STRING },
                    missingInformation: { type: Type.STRING },
                    limitations: { type: Type.STRING },
                  },
                },
              },
              limitations: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
          },
        };
        if (modelName === GEMINI_MODEL) {
          config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
        }

        const response = await withTimeout<any>(
          ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config,
          }),
          timeoutMs,
          `generateContent(${modelName})`
        );

        const textOutput = response?.text;
        if (!textOutput || typeof textOutput !== 'string' || textOutput.trim() === '') {
          const invalidErr: any = new Error('INVALID_MODEL_RESPONSE: Resposta vazia retornada pelo modelo Gemini.');
          invalidErr.isInvalidResponse = true;
          throw invalidErr;
        }

        const parsed = JSON.parse(textOutput);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          const invalidErr: any = new Error('INVALID_MODEL_RESPONSE: JSON retornado não é um objeto estruturado.');
          invalidErr.isInvalidResponse = true;
          throw invalidErr;
        }

        return {
          provider: 'GEMINI',
          modelUsed: modelName,
          diagnostic: parsed.diagnostic || 'Diagnóstico gerado via Gemini.',
          facts: Array.isArray(parsed.facts) ? parsed.facts : [],
          hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
          estimates: Array.isArray(parsed.estimates) ? parsed.estimates : [],
          risks: Array.isArray(parsed.risks) ? parsed.risks : [],
          missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : [],
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          limitations: Array.isArray(parsed.limitations)
            ? parsed.limitations
            : ['Análise assistida por IA sujeita à qualidade dos dados contábeis fornecidos.'],
        };
      } catch (err: any) {
        const classified = classifyAndRecordGeminiError(modelName, err);
        lastNotice = classified.userMessage;
        console.info(`Diagnostic model ${modelName} unavailable (${classified.isQuota ? '429 quota' : classified.isTimeout ? 'timeout' : 'fallback'}); switching seamlessly.`);
      }
    }
  } else {
    lastNotice = 'GEMINI_API_KEY ausente; diagnóstico gerado via motor determinístico local.';
  }

  return generateLocalFallbackDiagnostic(reqData, lastNotice);
}

export function generateLocalFallbackDiagnostic(
  reqData: AIAnalysisRequest,
  fallbackReason?: string
): AIAnalysisResponse {
  const netRevenue = Number(reqData.dre.netRevenue || 0);
  const operatingResult = Number(reqData.dre.operatingResult || 0);
  const netProfit = Number(reqData.dre.netProfit || 0);
  const fixedExpenses = Number(reqData.dre.fixedExpenses || 0);
  const cmRatio = Number(reqData.indicators?.contributionMarginRatio || 0);
  const opMargin = Number(reqData.indicators?.operatingMargin || 0);
  const currentLiq = reqData.indicators?.currentLiquidity !== null && reqData.indicators?.currentLiquidity !== undefined
    ? Number(reqData.indicators.currentLiquidity)
    : null;
  const selic = reqData.macroIndicators.find(m => m.code === 'SELIC');

  const facts: string[] = [
    `Receita Líquida apurada no período: R$ ${netRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
    `Margem de Contribuição de ${cmRatio.toFixed(2)}% sobre a receita líquida.`,
    `Resultado Operacional Gerencial de Caixa: R$ ${operatingResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (margem de ${opMargin.toFixed(2)}%).`,
    `Lucro Líquido Gerencial: R$ ${netProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
  ];
  if (currentLiq !== null) {
    facts.push(`Liquidez Corrente de ${currentLiq.toFixed(2)}x.`);
  }
  if (selic) {
    facts.push(`Taxa Selic de referência: ${selic.value}% a.a. (${selic.source}, ref. ${selic.referenceDate}).`);
  }

  const hypotheses: string[] = [];
  if (cmRatio < 40) {
    hypotheses.push('A margem de contribuição abaixo de 40% pode decorrer de aumento de CMV junto a fornecedores, descontos promocionais excessivos ou taxas de parcelamento no cartão.');
  } else {
    hypotheses.push('O mix atual de produtos preserva margem de contribuição saudável, sugerindo que eventuais pressões no lucro vêm de despesas fixas ou encargos financeiros.');
  }
  if (netRevenue > 0 && fixedExpenses / netRevenue > 0.28) {
    hypotheses.push('A participação elevada de despesas fixas sobre a receita sugere possível ociosidade de ponto comercial ou estrutura fixa rígida frente à oscilação mensal de vendas.');
  }

  const missingInfoList: string[] = Array.isArray(reqData.indicators?.missingInformation)
    ? reqData.indicators.missingInformation.map((m: any) => `${m.field}: ${m.impacts}`)
    : [];

  const risks: AIAnalysisResponse['risks'] = [];
  if (operatingResult <= 0) {
    risks.push({
      title: 'Consumo de Caixa Operacional',
      severity: 'ALTA',
      evidence: `Resultado operacional gerencial de R$ ${operatingResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
      mitigation: 'Revisar imediatamente despesas fixas, giro de estoque parado e política de descontos.',
    });
  }
  if (currentLiq !== null && currentLiq < 1.2) {
    risks.push({
      title: 'Margem Estreita de Liquidez de Curto Prazo',
      severity: currentLiq < 1 ? 'ALTA' : 'MÉDIA',
      evidence: `Liquidez corrente em ${currentLiq.toFixed(2)}x.`,
      mitigation: 'Alongar perfil de dívidas de curto prazo e acelerar conversão de estoques.',
    });
  }
  if (reqData.debtSummary && Number(reqData.debtSummary.floatingRateDebt || 0) > 0) {
    risks.push({
      title: 'Exposição a Juros Pós-Fixados (Selic/CDI)',
      severity: 'MÉDIA',
      evidence: `Dívida pós-fixada de R$ ${Number(reqData.debtSummary.floatingRateDebt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${reqData.debtSummary.floatingSharePct}% do endividamento).`,
      mitigation: 'Monitorar ciclo de juros e priorizar amortização da linha com maior spread.',
    });
  }

  const recommendations: StructuredRecommendation[] = [
    {
      horizon: 'Curto Prazo (0-30 dias)',
      problem: 'Controle do Ponto de Equilíbrio e Despesas Fixas',
      evidence: `Despesas fixas de R$ ${fixedExpenses.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} frente a resultado operacional de R$ ${operatingResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
      hypothesis: 'Existência de contratos fixos ou despesas administrativas sem revisão periódica.',
      action: 'Auditar os 5 maiores centros de despesa fixa e renegociar prazos com fornecedores principais.',
      impact: 'Calculável via Simulador ao definir meta percentual de redução de despesas fixas.',
      confidence: 'Alta (fundamentada diretamente na DRE auditada)',
      missingInformation: missingInfoList[0] || 'Detalhamento analítico por centro de custo.',
      limitations: 'Não considera multas contratuais de rescisão nem sazonalidade de vendas.',
    },
    {
      horizon: 'Médio Prazo (30-60 dias)',
      problem: 'Gestão de Margem de Contribuição e Capital de Giro',
      evidence: `Margem de contribuição atual de ${cmRatio.toFixed(2)}% (${reqData.taxRegime || 'Regime padrão'}).`,
      hypothesis: 'Concentração de vendas em itens promocionais de menor margem ou prazo médio de estoque elevado.',
      action: 'Segregar margem por categoria de produto (vestuário básico vs coleção) e revisar política de parcelamento.',
      impact: 'Depende da composição real do mix por SKU.',
      confidence: 'Média (requer abertura por categoria de produto)',
      missingInformation: 'Margem e giro de estoque por linha de produto.',
      limitations: 'Diagnóstico agregado no nível mensal da empresa.',
    },
  ];

  const diagnosticText = `Diagnóstico Determinístico (Fallback Local — sem síntese generativa externa): A empresa ${reqData.companyName} (${reqData.taxRegime || 'Regime não especificado'}) registrou Receita Líquida de R$ ${netRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, Margem de Contribuição de ${cmRatio.toFixed(2)}% e Resultado Operacional Gerencial de Caixa de R$ ${operatingResult.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`;

  return {
    provider: 'LOCAL_FALLBACK',
    modelUsed: 'deterministic-local-engine',
    fallbackReason,
    diagnostic: diagnosticText,
    facts,
    hypotheses,
    estimates: ['Consulte o Simulador de Decisões para projeções quantitativas condicionadas a premissas explícitas.'],
    risks,
    missingInformation: missingInfoList,
    recommendations,
    limitations: [
      fallbackReason || 'Executado em modo Fallback Local (GEMINI_API_KEY ausente ou indisponível).',
      'Recomendações geradas por regras determinísticas sobre os dados do período selecionado.',
    ],
  };
}
