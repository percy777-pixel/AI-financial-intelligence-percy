import { Type } from '@google/genai';
import {
  classifyAndRecordGeminiError,
  DEFAULT_GEMINI_TIMEOUT_MS,
  GEMINI_FALLBACK_MODEL,
  GEMINI_MODEL,
  GEMINI_TERTIARY_MODEL,
  getGeminiClient,
  isModelOnCooldown,
  withTimeout,
} from './aiService.js';

export type SectorNewsTopic =
  | 'GERAL'
  | 'INSUMOS_CAMBIO'
  | 'TRIBUTACAO_IMPORTADOS'
  | 'VAREJO_CONSUMO'
  | 'CLIMA_ESTOQUES'
  | 'SUSTENTABILIDADE_INOVACAO';

export interface GroundingSourceLink {
  title: string;
  uri: string;
}

export interface SectorNewsAlertItem {
  id: string;
  title: string;
  category: string;
  publishedContext: string;
  urgency: 'ALTA' | 'MÉDIA' | 'BAIXA';
  impactDirection: 'PRESSAO_CUSTO' | 'RISCO_RECEITA' | 'OPORTUNIDADE' | 'REGULATORIO';
  summary: string;
  sectorImpact: string;
  financialDreImpact: string;
  howToPrepare: string[];
  suggestedSimulation?: {
    label: string;
    revenueChangePct: number;
    cmvChangePct: number;
    fixedExpensesChangePct: number;
  };
  sourceTitle?: string;
  sourceUrl?: string;
}

export interface SectorNewsRadarResponse {
  provider: 'GEMINI_SEARCH_GROUNDING' | 'LOCAL_CURATED_FALLBACK';
  modelUsed: string;
  topic: SectorNewsTopic;
  customQuery?: string;
  generatedAt: string;
  companyContextSummary?: string;
  executiveBriefing: string;
  macroTextileThermometer: {
    rawMaterialPressure: string;
    importCompetitionRisk: string;
    retailDemandOutlook: string;
    workingCapitalAlert: string;
  };
  newsAlerts: SectorNewsAlertItem[];
  preparationChecklist: Array<{
    horizon: 'Imediato (0-15 dias)' | 'Curto Prazo (15-45 dias)' | 'Pré-Coleção (45-90 dias)';
    area: 'Compras & CMV' | 'Precificação & Margem' | 'Estoque & Giro' | 'Tributário & Caixa';
    action: string;
    expectedProtection: string;
  }>;
  groundingSources: GroundingSourceLink[];
  searchQueries: string[];
  fallbackReason?: string;
}

const TOPIC_DESCRIPTIONS: Record<SectorNewsTopic, string> = {
  GERAL:
    'Notícias recentes sobre a indústria têxtil, confecção e varejo de vestuário no Brasil (ABIT, IEMI, varejistas de moda, custos, tributação e consumo)',
  INSUMOS_CAMBIO:
    'Custos de matérias-primas têxteis (algodão, fios sintéticos, poliéster, energia), câmbio USD/BRL, frete internacional e impacto no CMV de confecções e varejo',
  TRIBUTACAO_IMPORTADOS:
    'Reforma tributária no setor têxtil e vestuário, tributação de remessas internacionais / fast-fashion asiático, ICMS, desoneração da folha e incentivos fiscais',
  VAREJO_CONSUMO:
    'Vendas do varejo de tecido, vestuário e calçados (IBGE PMC), crédito ao consumidor, juros Selic, inadimplência e comportamento de compra de moda',
  CLIMA_ESTOQUES:
    'Impactos climáticos (El Niño / La Niña, temperaturas atípicas) nas coleções de inverno/verão, liquidações antecipadas e gestão de estoque no vestuário',
  SUSTENTABILIDADE_INOVACAO:
    'Rastreabilidade têxtil, moda circular, automação no corte/costura, inteligência em previsão de demanda e exigências ESG no setor de vestuário',
};

function extractGroundingSources(response: any): {
  sources: GroundingSourceLink[];
  queries: string[];
} {
  const candidate = response?.candidates?.[0];
  const metadata = candidate?.groundingMetadata;
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const rawQueries = Array.isArray(metadata?.webSearchQueries) ? metadata.webSearchQueries : [];

  const seenUris = new Set<string>();
  const sources: GroundingSourceLink[] = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    const title = chunk?.web?.title;
    if (typeof uri === 'string' && uri.trim().length > 0 && !seenUris.has(uri)) {
      seenUris.add(uri);
      sources.push({
        uri: uri.trim(),
        title: typeof title === 'string' && title.trim().length > 0 ? title.trim() : uri.trim(),
      });
    }
  }

  const queries = rawQueries
    .filter((q: unknown): q is string => typeof q === 'string' && q.trim().length > 0)
    .map((q: string) => q.trim());

  return { sources, queries };
}

function parseJsonFromGroundedText(rawText: string): any | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try extracting JSON code block or outermost braces
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {
        // continue
      }
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function fetchTextileSectorNewsRadar(params: {
  topic?: SectorNewsTopic;
  customQuery?: string;
  companyName?: string;
  taxRegime?: string;
  dreSummary?: {
    netRevenue?: string;
    cmv?: string;
    contributionMarginPercentage?: string;
    operatingResultPercentage?: string;
    netProfitPercentage?: string;
  };
  macroSummary?: Array<{ code: string; value: number; unit: string }>;
}): Promise<SectorNewsRadarResponse> {
  const topic: SectorNewsTopic = params.topic || 'GERAL';
  const customQuery = params.customQuery?.trim() || undefined;
  const ai = getGeminiClient();
  let lastNotice: string | undefined;

  const companyContextLine = params.companyName
    ? `Empresa analisada: "${params.companyName}" (Regime: ${params.taxRegime || 'Simples Nacional'}). ` +
      (params.dreSummary
        ? `Receita Líquida: R$ ${Number(params.dreSummary.netRevenue || 0).toLocaleString('pt-BR')} | CMV: R$ ${Number(params.dreSummary.cmv || 0).toLocaleString('pt-BR')} | Margem de Contribuição: ${params.dreSummary.contributionMarginPercentage || '0'}% | Margem Operacional: ${params.dreSummary.operatingResultPercentage || '0'}%.`
        : '')
    : 'Contexto setorial para empresas de confecção, indústria têxtil e varejo de vestuário no Brasil.';

  const macroLine =
    params.macroSummary && params.macroSummary.length > 0
      ? `Indicadores macro atuais no sistema: ${params.macroSummary.map(m => `${m.code}: ${m.value}${m.unit}`).join(', ')}.`
      : '';

  if (ai) {
    // Always prioritize gemini-4-hydrogen with googleSearch as requested
    const candidates = [GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_TERTIARY_MODEL].filter(
      m => !isModelOnCooldown(m)
    );

    const searchFocus = customQuery
      ? `Foco específico solicitado pelo gestor: "${customQuery}" dentro do setor têxtil e de vestuário.`
      : `Foco temático: ${TOPIC_DESCRIPTIONS[topic]}.`;

    const prompt = `
Você é um estrategista e consultor financeiro sênior especializado no Setor Têxtil, Confecção e Varejo de Vestuário no Brasil.
Use a ferramenta Google Search para buscar notícias reais, fatos recentes, indicadores da ABIT (Associação Brasileira da Indústria Têxtil e de Confecção), IEMI, IBGE (PMC vestuário), cotações de insumos (algodão, fios sintéticos, dólar), mudanças tributárias/aduaneiras e tendências do varejo de moda que impactam o setor e exigem preparação imediata dos gestores.

${searchFocus}
${companyContextLine}
${macroLine}

Retorne EXCLUSIVAMENTE um objeto JSON válido (sem texto fora do JSON) seguindo exatamente esta estrutura:
{
  "executiveBriefing": "Síntese executiva densa (3 a 4 frases) sobre o momento atual do setor têxtil e de vestuário e os principais vetores de atenção.",
  "macroTextileThermometer": {
    "rawMaterialPressure": "Status curto e direto sobre pressão em algodão, fios sintéticos, energia e câmbio",
    "importCompetitionRisk": "Status curto sobre concorrência de importados, alíquotas e plataformas internacionais",
    "retailDemandOutlook": "Status curto sobre demanda de vestuário, crédito e poder de compra",
    "workingCapitalAlert": "Status curto sobre estoques de coleção, prazos médios e custo de giro"
  },
  "newsAlerts": [
    {
      "id": "news-1",
      "title": "Título claro e jornalístico da notícia ou tendência recente do setor têxtil/vestuário",
      "category": "Matéria-Prima & Câmbio | Tributário & Importação | Demanda & Varejo | Clima & Coleções | Indústria & ESG",
      "publishedContext": "Contexto temporal / fonte (ex.: ABIT / Valor / IBGE / Mercado Têxtil recente)",
      "urgency": "ALTA",
      "impactDirection": "PRESSAO_CUSTO",
      "summary": "Resumo objetivo do fato noticiado e por que está acontecendo.",
      "sectorImpact": "Como isso afeta confecções, facções, atacado e varejo de moda no Brasil.",
      "financialDreImpact": "Qual linha da DRE e do Fluxo de Caixa sofre impacto direto (ex.: CMV, Deduções, Despesas Financeiras, Giro de Estoque) considerando a empresa analisada.",
      "howToPrepare": [
        "Ação prática 1 para a empresa se antecipar e proteger margem/caixa",
        "Ação prática 2 de preparação operacional ou comercial",
        "Ação prática 3 de governança financeira"
      ],
      "suggestedSimulation": {
        "label": "Nome do teste de estresse sugerido no Simulador",
        "revenueChangePct": -3,
        "cmvChangePct": 5,
        "fixedExpensesChangePct": 0
      },
      "sourceTitle": "Nome do veículo ou entidade fonte",
      "sourceUrl": "URL da fonte caso disponível"
    }
  ],
  "preparationChecklist": [
    {
      "horizon": "Imediato (0-15 dias)",
      "area": "Compras & CMV",
      "action": "Ação específica de preparação",
      "expectedProtection": "Resultado esperado na proteção de margem ou caixa"
    }
  ]
}

Gere entre 4 e 6 itens em "newsAlerts" cobrindo os impactos mais relevantes e atuais, e 4 itens em "preparationChecklist" cobrindo horizontes imediato, curto prazo e pré-coleção.
`;

    for (const modelName of candidates) {
      try {
        const response = await withTimeout<any>(
          ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  executiveBriefing: { type: Type.STRING },
                  macroTextileThermometer: {
                    type: Type.OBJECT,
                    properties: {
                      rawMaterialPressure: { type: Type.STRING },
                      importCompetitionRisk: { type: Type.STRING },
                      retailDemandOutlook: { type: Type.STRING },
                      workingCapitalAlert: { type: Type.STRING },
                    },
                  },
                  newsAlerts: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        category: { type: Type.STRING },
                        publishedContext: { type: Type.STRING },
                        urgency: { type: Type.STRING },
                        impactDirection: { type: Type.STRING },
                        summary: { type: Type.STRING },
                        sectorImpact: { type: Type.STRING },
                        financialDreImpact: { type: Type.STRING },
                        howToPrepare: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        suggestedSimulation: {
                          type: Type.OBJECT,
                          properties: {
                            label: { type: Type.STRING },
                            revenueChangePct: { type: Type.NUMBER },
                            cmvChangePct: { type: Type.NUMBER },
                            fixedExpensesChangePct: { type: Type.NUMBER },
                          },
                        },
                        sourceTitle: { type: Type.STRING },
                        sourceUrl: { type: Type.STRING },
                      },
                    },
                  },
                  preparationChecklist: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        horizon: { type: Type.STRING },
                        area: { type: Type.STRING },
                        action: { type: Type.STRING },
                        expectedProtection: { type: Type.STRING },
                      },
                    },
                  },
                },
              },
            },
          }),
          DEFAULT_GEMINI_TIMEOUT_MS + 10000,
          `fetchTextileSectorNewsRadar(${modelName})`
        );

        const parsed = parseJsonFromGroundedText(response?.text || '');
        const { sources, queries } = extractGroundingSources(response);

        if (parsed && Array.isArray(parsed.newsAlerts) && parsed.newsAlerts.length > 0) {
          const normalizedAlerts: SectorNewsAlertItem[] = parsed.newsAlerts.map((item: any, idx: number) => {
            const matchedSource = sources[idx] || sources[0];
            return {
              id: item.id || `news-${idx + 1}`,
              title: item.title || 'Tendência Setorial Têxtil & Vestuário',
              category: item.category || 'Setor Têxtil & Moda',
              publishedContext: item.publishedContext || 'Monitoramento em Tempo Real via Google Search',
              urgency: ['ALTA', 'MÉDIA', 'BAIXA'].includes(String(item.urgency || '').toUpperCase())
                ? (String(item.urgency).toUpperCase() as 'ALTA' | 'MÉDIA' | 'BAIXA')
                : 'MÉDIA',
              impactDirection: [
                'PRESSAO_CUSTO',
                'RISCO_RECEITA',
                'OPORTUNIDADE',
                'REGULATORIO',
              ].includes(String(item.impactDirection || '').toUpperCase())
                ? (String(item.impactDirection).toUpperCase() as SectorNewsAlertItem['impactDirection'])
                : 'PRESSAO_CUSTO',
              summary: item.summary || '',
              sectorImpact: item.sectorImpact || '',
              financialDreImpact: item.financialDreImpact || '',
              howToPrepare: Array.isArray(item.howToPrepare) ? item.howToPrepare : [],
              suggestedSimulation: item.suggestedSimulation
                ? {
                    label: String(item.suggestedSimulation.label || item.title || 'Cenário Têxtil'),
                    revenueChangePct: Number(item.suggestedSimulation.revenueChangePct || 0),
                    cmvChangePct: Number(item.suggestedSimulation.cmvChangePct || 0),
                    fixedExpensesChangePct: Number(item.suggestedSimulation.fixedExpensesChangePct || 0),
                  }
                : undefined,
              sourceTitle: item.sourceTitle || matchedSource?.title,
              sourceUrl:
                item.sourceUrl && String(item.sourceUrl).startsWith('http')
                  ? item.sourceUrl
                  : matchedSource?.uri,
            };
          });

          return {
            provider: 'GEMINI_SEARCH_GROUNDING',
            modelUsed: modelName,
            topic,
            customQuery,
            generatedAt: new Date().toISOString(),
            companyContextSummary: companyContextLine,
            executiveBriefing:
              parsed.executiveBriefing ||
              'Panorama atualizado do setor têxtil e de vestuário com fundamentação via Google Search.',
            macroTextileThermometer: {
              rawMaterialPressure:
                parsed.macroTextileThermometer?.rawMaterialPressure ||
                'Oscilação cambial e custos de fibras sintéticas/algodão exigem travamento antecipado de compras.',
              importCompetitionRisk:
                parsed.macroTextileThermometer?.importCompetitionRisk ||
                'Pressão competitiva de plataformas internacionais e ajustes de ICMS/II sobre remessas.',
              retailDemandOutlook:
                parsed.macroTextileThermometer?.retailDemandOutlook ||
                'Consumo sensível ao custo de crédito e seletividade por peças de maior versatilidade.',
              workingCapitalAlert:
                parsed.macroTextileThermometer?.workingCapitalAlert ||
                'Necessidade de giro rápido de coleção para evitar markdowns agressivos no fim da estação.',
            },
            newsAlerts: normalizedAlerts,
            preparationChecklist:
              Array.isArray(parsed.preparationChecklist) && parsed.preparationChecklist.length > 0
                ? parsed.preparationChecklist
                : buildDefaultPreparationChecklist(),
            groundingSources: sources,
            searchQueries: queries,
          };
        }
      } catch (err: any) {
        const classified = classifyAndRecordGeminiError(modelName, err);
        lastNotice = classified.userMessage;
      }
    }
  } else {
    lastNotice = 'GEMINI_API_KEY ausente; exibindo radar setorial têxtil curado localmente.';
  }

  return buildFallbackTextileNewsRadar({
    topic,
    customQuery,
    companyContextLine,
    fallbackReason: lastNotice,
  });
}

function buildDefaultPreparationChecklist(): SectorNewsRadarResponse['preparationChecklist'] {
  return [
    {
      horizon: 'Imediato (0-15 dias)',
      area: 'Compras & CMV',
      action:
        'Mapear SKUs da curva A com maior dependência de fios importados/algodão e negociar trava de preço ou lote programado com tecelagens.',
      expectedProtection: 'Proteção de 1,5 p.p. a 3,0 p.p. na Margem de Contribuição contra repasses súbitos de insumos.',
    },
    {
      horizon: 'Imediato (0-15 dias)',
      area: 'Estoque & Giro',
      action:
        'Revisar cobertura de estoque por categoria (básicos vs. moda/estação) e acionar combos promocionais cirúrgicos em itens com giro superior a 75 dias.',
      expectedProtection: 'Liberação de caixa operacional antes da entrada de faturas da nova coleção.',
    },
    {
      horizon: 'Curto Prazo (15-45 dias)',
      area: 'Precificação & Margem',
      action:
        'Recalibrar markup por linha de produto considerando taxas de antecipação de recebíveis (cartão em 3x a 6x) e alíquota efetiva do regime tributário.',
      expectedProtection: 'Preservação do Resultado Operacional de Caixa mesmo com aumento de vendas parceladas.',
    },
    {
      horizon: 'Pré-Coleção (45-90 dias)',
      area: 'Tributário & Caixa',
      action:
        'Fracionar grade de lançamento (modelo Open-to-Buy / reposição rápida com facções homologadas) para reduzir risco climático na virada de estação.',
      expectedProtection: 'Redução de até 25% nas remarcações (markdowns) de fim de temporada.',
    },
  ];
}

function buildFallbackTextileNewsRadar(params: {
  topic: SectorNewsTopic;
  customQuery?: string;
  companyContextLine: string;
  fallbackReason?: string;
}): SectorNewsRadarResponse {
  const alerts: SectorNewsAlertItem[] = [
    {
      id: 'textile-alert-1',
      title: 'Oscilação do Dólar e Custos de Fibras Sintéticas Pressionam Tecelagens e Confecções',
      category: 'Matéria-Prima & Câmbio',
      publishedContext: 'Monitoramento Setorial ABIT / Cadeia Têxtil Nacional',
      urgency: 'ALTA',
      impactDirection: 'PRESSAO_CUSTO',
      summary:
        'A volatilidade cambial e o custo internacional de poliéster, elastano e corantes químicos vêm elevando as tabelas de reposição de malharias e tecelagens para os próximos pedidos.',
      sectorImpact:
        'Confecções e varejistas de vestuário sem contratos de fornecimento programado enfrentam reajustes de 4% a 7% no custo de tecidos planos e malhas.',
      financialDreImpact:
        'Aumento direto no CMV / CPV, comprimindo a Margem de Contribuição caso o repasse de preço ao consumidor seja limitado pela elasticidade da demanda.',
      howToPrepare: [
        'Antecipar fechamento de cota de tecidos básicos (curva A) com fornecedores nacionais para travar tabela atual.',
        'Revisar fichas técnicas de modelagem para reduzir desperdício de encaixe e risco no corte.',
        'Simular no motor financeiro um choque de +5% no CMV para definir o reajuste mínimo necessário no ticket médio.',
      ],
      suggestedSimulation: {
        label: 'Choque de +5% no CMV (Tecidos & Aviamentos)',
        revenueChangePct: 0,
        cmvChangePct: 5,
        fixedExpensesChangePct: 0,
      },
      sourceTitle: 'ABIT — Associação Brasileira da Indústria Têxtil e de Confecção',
      sourceUrl: 'https://www.abit.org.br',
    },
    {
      id: 'textile-alert-2',
      title: 'Tributação sobre Remessas Internacionais e Transição do IVA na Reforma Tributária para Moda',
      category: 'Tributário & Importação',
      publishedContext: 'Ambiente Regulatório & Competitividade no Varejo de Vestuário',
      urgency: 'ALTA',
      impactDirection: 'REGULATORIO',
      summary:
        'Mudanças na fiscalização de remessas internacionais de plataformas de fast-fashion asiáticas e a regulamentação da CBS/IBS redesenham a formação de preços e créditos tributários na cadeia têxtil.',
      sectorImpact:
        'Reduz parcialmente a assimetria competitiva no ticket de entrada, mas exige revisão de precificação, NCM e estrutura tributária (Simples Nacional vs. Lucro Presumido/Real).',
      financialDreImpact:
        'Impacta diretamente a linha de Deduções / Impostos sobre Vendas e a competitividade de preço líquido nas faixas de entrada.',
      howToPrepare: [
        'Auditar a carga tributária efetiva atual e comparar cenários de regime tributário no Simulador Avançado.',
        'Posicionar linhas de pronta-entrega e reposição rápida onde o varejo local possui vantagem logística frente ao importado.',
        'Revisar cadastro fiscal (NCM) de peças de vestuário e acessórios junto à contabilidade.',
      ],
      suggestedSimulation: {
        label: 'Ganho de Volume (+6% Receita) com Ajuste Competitivo',
        revenueChangePct: 6,
        cmvChangePct: 3,
        fixedExpensesChangePct: 1,
      },
      sourceTitle: 'IEMI — Inteligência de Mercado Têxtil e Vestuário',
      sourceUrl: 'https://www.iemi.com.br',
    },
    {
      id: 'textile-alert-3',
      title: 'Clima Atípico e Estações Irregulares Exigem Grade Fracionada e Coleções Cápsula',
      category: 'Clima & Coleções',
      publishedContext: 'Gestão de Estoques & Calendário do Varejo de Moda',
      urgency: 'MÉDIA',
      impactDirection: 'RISCO_RECEITA',
      summary:
        'Ondas de calor fora de época e atrasos na entrada do frio têm provocado acúmulo de peças pesadas no varejo, forçando liquidações precoces que corroem a margem bruta.',
      sectorImpact:
        'Marcas que comprometem 100% do orçamento de compras antes da estação sofrem com imobilização de capital de giro e necessidade de descontos acima de 30%.',
      financialDreImpact:
        'Eleva a necessidade de Capital de Giro (Estoques), reduz a Receita Líquida por descontos promocionais e pressiona a Liquidez Corrente.',
      howToPrepare: [
        'Adotar modelo Open-to-Buy: comprometer 60% do orçamento no lançamento e reter 40% para reposição rápida dos best-sellers.',
        'Aumentar a participação de peças meia-estação e tecidos respiráveis de alta versatilidade.',
        'Monitorar semanalmente a cobertura de estoque em dias para liquidar itens lentos no início da curva.',
      ],
      suggestedSimulation: {
        label: 'Liquidação Climática (-6% Receita por Markdown)',
        revenueChangePct: -6,
        cmvChangePct: 0,
        fixedExpensesChangePct: 0,
      },
      sourceTitle: 'IBGE — Pesquisa Mensal de Comércio (Tecidos, Vestuário e Calçados)',
      sourceUrl: 'https://www.ibge.gov.br/estatisticas/economicas/comercio/9227-pesquisa-mensal-de-comercio.html',
    },
    {
      id: 'textile-alert-4',
      title: 'Juros Elevados Encarecem Antecipação de Recebíveis e Capital de Giro no Varejo de Moda',
      category: 'Demanda & Varejo',
      publishedContext: 'Conjuntura Monetária & Crédito ao Varejo',
      urgency: 'ALTA',
      impactDirection: 'PRESSAO_CUSTO',
      summary:
        'Com a taxa básica de juros em patamar restritivo, o desconto de duplicatas e a antecipação de vendas parceladas no cartão consomem fatia crescente da geração de caixa das lojas de vestuário.',
      sectorImpact:
        'O ciclo financeiro longo do setor (compra de tecido -> facção -> estoque -> venda em 4x a 6x) amplifica o custo financeiro mensal.',
      financialDreImpact:
        'Aumenta as Despesas Financeiras e eleva o Ponto de Equilíbrio Financeiro da operação.',
      howToPrepare: [
        'Embutir o custo financeiro real do parcelamento acima de 3x na formação de preço ou incentivar pagamento via PIX com desconto calculado.',
        'Renegociar taxas de MDR e antecipação automática com adquirentes de maquininhas.',
        'Priorizar amortização de contratos de dívida pós-fixados (CDI/Selic) com maior spread bancário.',
      ],
      suggestedSimulation: {
        label: 'Aperto de Crédito (-4% Vendas, -3% Despesas Fixas)',
        revenueChangePct: -4,
        cmvChangePct: -4,
        fixedExpensesChangePct: -3,
      },
      sourceTitle: 'Banco Central do Brasil — Relatório de Economia Bancária',
      sourceUrl: 'https://www.bcb.gov.br',
    },
  ];

  return {
    provider: 'LOCAL_CURATED_FALLBACK',
    modelUsed: 'curated-textile-intelligence-engine',
    topic: params.topic,
    customQuery: params.customQuery,
    generatedAt: new Date().toISOString(),
    companyContextSummary: params.companyContextLine,
    executiveBriefing:
      'O setor têxtil e de vestuário atravessa um ciclo que exige disciplina rigorosa em três frentes: proteção de margem bruta frente à volatilidade do dólar nos insumos, gestão de estoques com coleções mais enxutas e reativas ao clima, e controle estrito do custo financeiro de antecipação de recebíveis.',
    macroTextileThermometer: {
      rawMaterialPressure: 'ALTA — Dólar e fibras sintéticas exigem compras programadas',
      importCompetitionRisk: 'MODERADA A ALTA — Disputa por preço em básicos e fast-fashion',
      retailDemandOutlook: 'SELETIVA — Consumidor prioriza custo-benefício e parcelamento',
      workingCapitalAlert: 'CRÍTICO — Ciclo entre compra de malha e recebimento do cartão pressiona caixa',
    },
    newsAlerts: alerts,
    preparationChecklist: buildDefaultPreparationChecklist(),
    groundingSources: [
      { title: 'ABIT — Associação Brasileira da Indústria Têxtil e de Confecção', uri: 'https://www.abit.org.br' },
      { title: 'IBGE — Pesquisa Mensal de Comércio (Vestuário e Calçados)', uri: 'https://www.ibge.gov.br/estatisticas/economicas/comercio/9227-pesquisa-mensal-de-comercio.html' },
      { title: 'IEMI — Inteligência de Mercado Têxtil', uri: 'https://www.iemi.com.br' },
    ],
    searchQueries: [
      'noticias setor textil e vestuario brasil impactos ABIT',
      'custos algodao fios cambio confecao varejo moda',
      'perspectivas varejo vestuario reforma tributaria importados',
    ],
    fallbackReason: params.fallbackReason,
  };
}
