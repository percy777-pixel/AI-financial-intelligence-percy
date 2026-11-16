import {
  calculateDRE,
  calculateIndicators,
  compareFinancialRecords,
  serializeDRE,
  serializeIndicators,
  validateFinancialInput,
} from './financialEngine.js';
import { getCompanyById, getCompanyPeriods, getDebtFacilities, saveAnalysisReport } from './dataStore.js';
import { getLatestMacroIndicators } from './macroService.js';
import { analyzeDebtAndEconomicContext } from './economicContextService.js';
import { buildScenarioComparisonSuite } from './scenarioService.js';
import { generateFinancialDiagnosticAndRecommendations } from './aiService.js';

export interface ExecutiveReportPayload {
  reportId?: string;
  generatedAt: string;
  company: {
    id: string;
    name: string;
    cnpj?: string | null;
    industry?: string | null;
    taxRegime?: string | null;
    isDemo?: boolean;
  };
  periodRef: string;
  dataVersionRef: string;
  provider: string;
  financialSummary: {
    dre: ReturnType<typeof serializeDRE>;
    indicators: ReturnType<typeof serializeIndicators>;
    validation: ReturnType<typeof validateFinancialInput>;
  };
  periodEvolution: any;
  macroContext: {
    indicators: any[];
    economicAnalysis: ReturnType<typeof analyzeDebtAndEconomicContext>;
  };
  scenarios: ReturnType<typeof buildScenarioComparisonSuite>;
  diagnosticAndRecommendations: Awaited<ReturnType<typeof generateFinancialDiagnosticAndRecommendations>>;
  missingData: Array<{ field: string; impacts: string }>;
  sourcesAndLimitations: {
    sources: string[];
    limitations: string[];
  };
  markdown: string;
}

export async function generateExecutiveReport(
  companyId: string,
  periodYear?: number,
  periodMonth?: number
): Promise<ExecutiveReportPayload> {
  const company = await getCompanyById(companyId);
  if (!company) {
    throw new Error('Empresa não encontrada para geração de relatório.');
  }

  const periods = await getCompanyPeriods(companyId);
  if (periods.length === 0) {
    throw new Error('Empresa não possui períodos financeiros registrados.');
  }

  let targetPeriod = periods[0];
  if (periodYear !== undefined || periodMonth !== undefined) {
    const matched = periods.find(
      p =>
        (periodYear === undefined || p.year === periodYear) &&
        (periodMonth === undefined || p.month === periodMonth)
    );
    if (!matched) {
      const available = periods
        .map(p => `${p.month ? `${String(p.month).padStart(2, '0')}/` : ''}${p.year}`)
        .join(', ');
      throw new Error(
        `Período solicitado (${periodMonth ? `${String(periodMonth).padStart(2, '0')}/` : ''}${periodYear ?? '*'}) não encontrado para "${company.name}". Períodos disponíveis: ${available}.`
      );
    }
    targetPeriod = matched;
  }

  const latestVersion = targetPeriod.versions[0];
  if (!latestVersion) {
    throw new Error('Período selecionado não possui versão calculada.');
  }

  const rawInput = {
    ...latestVersion.rawData,
    taxRegime: latestVersion.rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
  };
  const dre = calculateDRE(rawInput);
  const indicators = calculateIndicators(dre, rawInput);
  const validation = validateFinancialInput(rawInput);
  const serializedDre = serializeDRE(dre);
  const serializedInd = serializeIndicators(indicators);

  // Period evolution vs previous period if available
  let periodEvolution: any = {
    available: false,
    note: 'Apenas 1 período disponível; adicione outro período para análise evolutiva.',
  };
  const targetIdx = periods.findIndex(p => p.id === targetPeriod.id);
  const previousPeriod = targetIdx >= 0 && targetIdx + 1 < periods.length ? periods[targetIdx + 1] : null;
  if (previousPeriod && previousPeriod.versions[0]) {
    const prevRaw = {
      ...previousPeriod.versions[0].rawData,
      taxRegime: previousPeriod.versions[0].rawData?.taxRegime || company.taxRegime || 'Simples Nacional',
    };
    const prevDre = calculateDRE(prevRaw);
    const prevLabel = `${previousPeriod.month ? `${String(previousPeriod.month).padStart(2, '0')}/` : ''}${previousPeriod.year}`;
    const currLabel = `${targetPeriod.month ? `${String(targetPeriod.month).padStart(2, '0')}/` : ''}${targetPeriod.year}`;
    periodEvolution = {
      available: true,
      comparison: compareFinancialRecords(prevLabel, prevDre, currLabel, dre),
    };
  }

  const macroIndicators = await getLatestMacroIndicators();
  const debtFacilities = await getDebtFacilities(companyId);
  const economicAnalysis = analyzeDebtAndEconomicContext(dre, debtFacilities, macroIndicators, company.industry);
  const scenarios = buildScenarioComparisonSuite(dre, debtFacilities);

  const periodLabel = `${targetPeriod.month ? `${String(targetPeriod.month).padStart(2, '0')}/` : ''}${targetPeriod.year}`;
  const versionLabel = `v${latestVersion.versionNumber}`;

  const diagnosticAndRecommendations = await generateFinancialDiagnosticAndRecommendations({
    companyName: company.name,
    industry: company.industry || undefined,
    taxRegime: company.taxRegime || undefined,
    dre: serializedDre,
    indicators: serializedInd,
    macroIndicators,
    debtSummary: economicAnalysis.debtExposureSummary,
    periodLabel: `${periodLabel} (${versionLabel})`,
  });

  const sources = [
    `DRE & Indicadores: Motor Determinístico Decimal.js (${company.name}, Período ${periodLabel}, Versão ${versionLabel}, criado em ${latestVersion.createdAt})`,
    ...macroIndicators.map(m => `${m.code}: ${m.value} ${m.unit} — ${m.source} (Ref: ${m.referenceDate}, Sync: ${m.syncSource})`),
  ];

  const limitations = Array.from(
    new Set([
      ...economicAnalysis.limitations,
      ...diagnosticAndRecommendations.limitations,
      ...scenarios.scenarios.baseCase.limitations,
    ])
  );

  const markdown = buildMarkdownReport({
    company,
    periodLabel,
    versionLabel,
    dre: serializedDre,
    indicators: serializedInd,
    periodEvolution,
    economicAnalysis,
    scenarios,
    diagnosticAndRecommendations,
    missingData: indicators.missingInformation,
    sources,
    limitations,
  });

  const saved = await saveAnalysisReport({
    companyId,
    reportType: 'EXECUTIVE_REPORT',
    provider: diagnosticAndRecommendations.provider,
    response: markdown,
    metadata: {
      periodRef: periodLabel,
      dataVersionRef: versionLabel,
      completenessPct: validation.completenessPct,
      risksCount: diagnosticAndRecommendations.risks.length,
    },
  });

  return {
    reportId: saved.id,
    generatedAt: saved.createdAt,
    company: {
      id: company.id,
      name: company.name,
      cnpj: company.cnpj,
      industry: company.industry,
      taxRegime: company.taxRegime,
      isDemo: company.isDemo,
    },
    periodRef: periodLabel,
    dataVersionRef: versionLabel,
    provider: diagnosticAndRecommendations.provider,
    financialSummary: {
      dre: serializedDre,
      indicators: serializedInd,
      validation,
    },
    periodEvolution,
    macroContext: {
      indicators: macroIndicators,
      economicAnalysis,
    },
    scenarios,
    diagnosticAndRecommendations,
    missingData: indicators.missingInformation,
    sourcesAndLimitations: {
      sources,
      limitations,
    },
    markdown,
  };
}

function buildMarkdownReport(ctx: any): string {
  const {
    company,
    periodLabel,
    versionLabel,
    dre,
    indicators,
    periodEvolution,
    economicAnalysis,
    scenarios,
    diagnosticAndRecommendations,
    missingData,
    sources,
    limitations,
  } = ctx;

  const lines: string[] = [
    `# Relatório Executivo de Inteligência Financeira`,
    `**Empresa:** ${company.name} | **Regime:** ${company.taxRegime || 'N/A'} | **Setor:** ${company.industry || 'N/A'}`,
    `**Período de Referência:** ${periodLabel} (${versionLabel}) | **Gerado em:** ${new Date().toISOString()}`,
    `**Provedor de Síntese:** ${diagnosticAndRecommendations.provider} (${diagnosticAndRecommendations.modelUsed})`,
    ``,
    `---`,
    `## 1. Situação Financeira (DRE Gerencial — Motor Determinístico)`,
    `- **Receita Bruta:** R$ ${Number(dre.grossRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `- **Receita Líquida:** R$ ${Number(dre.netRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `- **CMV/CPV:** R$ ${Number(dre.cmv).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `- **Margem de Contribuição:** R$ ${Number(dre.contributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${indicators.contributionMarginRatio}%)`,
    `- **Despesas Fixas Operacionais:** R$ ${Number(dre.fixedExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `- **Resultado Operacional Gerencial de Caixa:** R$ ${Number(dre.operatingResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${indicators.operatingMargin}%)`,
    `- **EBITDA:** R$ ${Number(dre.ebitda).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${indicators.ebitdaMargin}%)`,
    `- **Lucro Líquido Gerencial:** R$ ${Number(dre.netProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${indicators.netMargin}%)`,
    `- **Ponto de Equilíbrio Operacional:** R$ ${Number(dre.operatingBreakEven).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | **Margem de Segurança:** ${dre.safetyMargin}%`,
    ``,
    `## 2. Evolução dos Resultados`,
  ];

  if (periodEvolution.available) {
    const m = periodEvolution.comparison.metrics;
    lines.push(
      `Comparação entre **${periodEvolution.comparison.baseLabel}** e **${periodEvolution.comparison.targetLabel}**:`,
      `- **Receita Líquida:** ${m.netRevenue.percentChange ?? 'N/A'}% (Δ R$ ${Number(m.netRevenue.absoluteDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`,
      `- **Margem de Contribuição:** ${m.contributionMargin.percentChange ?? 'N/A'}%`,
      `- **Resultado Operacional:** ${m.operatingResult.percentChange ?? 'N/A'}%`,
      `- **Lucro Líquido:** ${m.netProfit.percentChange ?? 'N/A'}%`
    );
  } else {
    lines.push(periodEvolution.note);
  }

  lines.push(
    ``,
    `## 3. Indicadores de Liquidez, Capital de Giro e Endividamento`,
    `- **Liquidez Corrente:** ${indicators.currentLiquidity ?? 'Não calculável (dados ausentes)'}`,
    `- **Liquidez Seca:** ${indicators.quickLiquidity ?? 'Não calculável (dados ausentes)'}`,
    `- **Ciclo Financeiro (PME + PMR - PMP):** ${indicators.cashConversionCycle ? `${indicators.cashConversionCycle} dias` : 'Não calculável (dados ausentes)'}`,
    `- **Dívida Total Monitorada:** R$ ${Number(economicAnalysis.debtExposureSummary.totalOutstandingDebt).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${economicAnalysis.debtExposureSummary.floatingSharePct}% pós-fixada Selic/CDI/IPCA)`,
    ``,
    `## 4. Diagnóstico Inteligente (Fatos vs. Hipóteses)`,
    diagnosticAndRecommendations.diagnostic,
    ``,
    `### Fatos Observados`,
    ...diagnosticAndRecommendations.facts.map((f: string) => `- ${f}`),
    ``,
    `### Hipóteses a Confirmar`,
    ...diagnosticAndRecommendations.hypotheses.map((h: string) => `- ${h}`),
    ``,
    `## 5. Riscos Identificados`,
    ...(diagnosticAndRecommendations.risks.length > 0
      ? diagnosticAndRecommendations.risks.map((r: any) => `- **[${r.severity}] ${r.title}:** ${r.evidence} *Mitigação:* ${r.mitigation}`)
      : ['- Nenhum risco crítico imediato apontado pelos limiares atuais.']),
    ``,
    `## 6. Cenários Comparativos (Condicionais às Premissas)`,
    `- **Original:** Receita Líquida R$ ${Number(scenarios.scenarios.original.simulatedNetRevenue).toLocaleString('pt-BR')} | Lucro Líquido R$ ${Number(scenarios.scenarios.original.simulatedNetProfit).toLocaleString('pt-BR')}`,
    `- **Expansão Hipotética:** Receita Líquida R$ ${Number(scenarios.scenarios.optimistic.simulatedNetRevenue).toLocaleString('pt-BR')} | Lucro Líquido R$ ${Number(scenarios.scenarios.optimistic.simulatedNetProfit).toLocaleString('pt-BR')}`,
    `- **Adverso Hipotético:** Receita Líquida R$ ${Number(scenarios.scenarios.adverse.simulatedNetRevenue).toLocaleString('pt-BR')} | Lucro Líquido R$ ${Number(scenarios.scenarios.adverse.simulatedNetProfit).toLocaleString('pt-BR')}`,
    ``,
    `## 7. Recomendações Prioritárias`,
    ...diagnosticAndRecommendations.recommendations.map(
      (rec: any) => `- **[${rec.horizon}] ${rec.problem}:** ${rec.action} *(Evidência: ${rec.evidence} | Confiança: ${rec.confidence})*`
    ),
    ``,
    `## 8. Dados Ausentes`,
    ...(missingData.length > 0 ? missingData.map((m: any) => `- **${m.field}:** ${m.impacts}`) : ['- Nenhum campo crítico ausente.']),
    ``,
    `## 9. Fontes e Limitações`,
    ...sources.map((s: string) => `- Fonte: ${s}`),
    ...limitations.map((l: string) => `- Limitação: ${l}`)
  );

  return lines.join('\n');
}
