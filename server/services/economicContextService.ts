import Decimal from 'decimal.js';
import { CalculatedDRE } from './financialEngine.js';
import { MacroIndicatorData } from './macroService.js';

export interface DebtFacilityRecord {
  id: string;
  name: string;
  lender: string;
  principal: number;
  outstandingBalance: number;
  indexer: 'SELIC' | 'CDI' | 'IPCA' | 'PRE_FIXADO';
  spreadAnnualPct: number;
  monthlyPayment?: number | null;
  maturityDate?: string | null;
  notes?: string | null;
}

export interface EconomicContextAnalysis {
  quantitativeImpacts: Array<{
    channel: string;
    indicatorCode: string;
    currentRateOrValue: string;
    exposedBase: string;
    computedImpact: string;
    basis: string;
  }>;
  qualitativeContext: Array<{
    channel: string;
    indicatorCode: string;
    observation: string;
    reasonQualitativeOnly: string;
  }>;
  debtExposureSummary: {
    totalOutstandingDebt: string;
    floatingRateDebt: string;
    fixedRateDebt: string;
    floatingSharePct: string;
    estimatedAnnualInterestAtCurrentRates: string;
    estimatedMonthlyInterestAtCurrentRates: string;
    facilities: Array<{
      name: string;
      lender: string;
      outstandingBalance: string;
      indexer: string;
      effectiveAnnualRatePct: string;
      estimatedMonthlyInterest: string;
      affectedBySelic: boolean;
    }>;
  };
  limitations: string[];
}

export function analyzeDebtAndEconomicContext(
  dre: CalculatedDRE,
  debtFacilities: DebtFacilityRecord[],
  macroIndicators: MacroIndicatorData[],
  industry?: string | null
): EconomicContextAnalysis {
  const findMacro = (code: string) => macroIndicators.find(m => m.code === code);
  const selic = findMacro('SELIC');
  const cdi = findMacro('CDI');
  const ipca = findMacro('IPCA');
  const ptax = findMacro('PTAX');
  const pmc = findMacro('PMC');

  const selicRate = new Decimal(selic?.value ?? 11.25);
  const cdiRate = new Decimal(cdi?.value ?? 11.15);
  const ipcaRate = new Decimal(ipca?.value ?? 4.45);

  let totalDebt = new Decimal(0);
  let floatingDebt = new Decimal(0);
  let fixedDebt = new Decimal(0);
  let totalAnnualInterest = new Decimal(0);

  const facilitiesSummary = debtFacilities.map(f => {
    const balance = new Decimal(f.outstandingBalance || 0);
    const spread = new Decimal(f.spreadAnnualPct || 0);
    totalDebt = totalDebt.plus(balance);

    let effectiveRate = spread;
    let affectedBySelic = false;

    if (f.indexer === 'SELIC') {
      effectiveRate = selicRate.plus(spread);
      floatingDebt = floatingDebt.plus(balance);
      affectedBySelic = true;
    } else if (f.indexer === 'CDI') {
      // CDI tracks Selic closely in Brazil (~0.10 p.p. below Selic Meta)
      effectiveRate = cdiRate.plus(spread);
      floatingDebt = floatingDebt.plus(balance);
      affectedBySelic = true;
    } else if (f.indexer === 'IPCA') {
      effectiveRate = ipcaRate.plus(spread);
      floatingDebt = floatingDebt.plus(balance);
    } else {
      fixedDebt = fixedDebt.plus(balance);
    }

    const annualInt = balance.times(effectiveRate.dividedBy(100));
    const monthlyInt = annualInt.dividedBy(12);
    totalAnnualInterest = totalAnnualInterest.plus(annualInt);

    return {
      name: f.name,
      lender: f.lender,
      outstandingBalance: balance.toFixed(2),
      indexer: f.indexer,
      effectiveAnnualRatePct: effectiveRate.toFixed(2),
      estimatedMonthlyInterest: monthlyInt.toFixed(2),
      affectedBySelic,
    };
  });

  const floatingSharePct = totalDebt.isZero()
    ? new Decimal(0)
    : floatingDebt.dividedBy(totalDebt).times(100);
  const totalMonthlyInterest = totalAnnualInterest.dividedBy(12);

  // Quantitative impact: +1 p.p. Selic/CDI sensitivity on Selic/CDI-indexed debt
  const selicExposedDebt = debtFacilities
    .filter(f => f.indexer === 'SELIC' || f.indexer === 'CDI')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));

  const onePctShockMonthly = selicExposedDebt.times(0.01).dividedBy(12);
  const onePctShockAnnual = selicExposedDebt.times(0.01);

  const quantitativeImpacts: EconomicContextAnalysis['quantitativeImpacts'] = [];
  if (selicExposedDebt.gt(0)) {
    quantitativeImpacts.push({
      channel: 'Juros & Custo Financeiro (Exposição Pós-Fixada)',
      indicatorCode: 'SELIC / CDI',
      currentRateOrValue: `Selic ${selicRate.toFixed(2)}% a.a. / CDI ${cdiRate.toFixed(2)}% a.a.`,
      exposedBase: `R$ ${selicExposedDebt.toFixed(2)} em contratos pós-fixados`,
      computedImpact: `Cada +1,00 p.p. na Selic/CDI eleva o custo financeiro estimado em R$ ${onePctShockMonthly.toFixed(2)}/mês (R$ ${onePctShockAnnual.toFixed(2)}/ano).`,
      basis: 'Cálculo determinístico sobre o saldo devedor das linhas indexadas a SELIC e CDI (contratos pré-fixados ficam imunes até eventual renovação).',
    });
  }

  if (dre.netRevenue.gt(0) && totalMonthlyInterest.gt(0)) {
    const interestOverOperating = dre.operatingResult.gt(0)
      ? totalMonthlyInterest.dividedBy(dre.operatingResult).times(100).toFixed(1)
      : 'N/A (resultado operacional <= 0)';
    quantitativeImpacts.push({
      channel: 'Comprometimento do Resultado Operacional pelos Juros',
      indicatorCode: 'SELIC / CDI',
      currentRateOrValue: `Juros atuais estimados: R$ ${totalMonthlyInterest.toFixed(2)}/mês`,
      exposedBase: `Resultado Operacional de Caixa: R$ ${dre.operatingResult.toFixed(2)}`,
      computedImpact: `${interestOverOperating}% do resultado operacional mensal estimado é consumido pelo serviço de juros dos contratos vigentes.`,
      basis: 'Comparação direta entre juros estimados dos contratos cadastrados e resultado operacional gerencial.',
    });
  }

  const qualitativeContext: EconomicContextAnalysis['qualitativeContext'] = [
    {
      channel: 'Inflação e Custos de Aquisição / Despesas Operacionais',
      indicatorCode: 'IPCA',
      observation: `IPCA acumulado em 12 meses de ${ipcaRate.toFixed(2)}% (${ipca?.referenceDate || 'ref. recente'}). No varejo (${industry || 'Geral'}), o repasse de custos de fornecedores e aluguéis/energia pressiona CMV e despesas fixas caso não seja acompanhado de ajuste de preços.`,
      reasonQualitativeOnly: 'Análise qualitativa: não há histórico de contratos de fornecedores ou elasticidade de preço por SKU para calcular repasse automático.',
    },
    {
      channel: 'Câmbio e Insumos / Produtos Importados',
      indicatorCode: 'PTAX',
      observation: `Dólar PTAX em R$ ${(ptax?.value ?? 5.48).toFixed(2)} (${ptax?.referenceDate || 'ref. recente'}). Variações cambiais afetam o custo de reposição caso haja peças importadas ou tecidos/aviamentos atrelados ao dólar na cadeia têxtil.`,
      reasonQualitativeOnly: 'Análise qualitativa: a porcentagem exata do CMV indexada ao dólar não foi informada nos dados da empresa.',
    },
    {
      channel: 'Demanda Agregada no Varejo',
      indicatorCode: 'PMC',
      observation: `Índice PMC do IBGE em ${(pmc?.value ?? 104.2).toFixed(1)} pontos (${pmc?.referenceDate || 'ref. recente'}). Indica ritmo de demanda agregada do varejo; correlações setoriais não implicam causalidade direta nas vendas da loja.`,
      reasonQualitativeOnly: 'Análise qualitativa: o faturamento individual depende de mix, localização, canal e preço praticado pela empresa.',
    },
  ];

  return {
    quantitativeImpacts,
    qualitativeContext,
    debtExposureSummary: {
      totalOutstandingDebt: totalDebt.toFixed(2),
      floatingRateDebt: floatingDebt.toFixed(2),
      fixedRateDebt: fixedDebt.toFixed(2),
      floatingSharePct: floatingSharePct.toFixed(1),
      estimatedAnnualInterestAtCurrentRates: totalAnnualInterest.toFixed(2),
      estimatedMonthlyInterestAtCurrentRates: totalMonthlyInterest.toFixed(2),
      facilities: facilitiesSummary,
    },
    limitations: [
      'A sensibilidade à Selic assume transmissão proporcional de 1:1 para o CDI em contratos indexados ao CDI e não contempla amortizações futuras programadas nem IOF/tarifas de renovação.',
      'Pressões de IPCA, PTAX e PMC sobre CMV e demanda são apresentadas qualitativamente até que sejam fornecidos percentuais de importação ou elasticidade-preço verificada.',
    ],
  };
}
