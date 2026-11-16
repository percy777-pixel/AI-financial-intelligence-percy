import Decimal from 'decimal.js';
import { CalculatedDRE } from './financialEngine.js';
import { DebtFacilityRecord } from './economicContextService.js';

export interface ScenarioInput {
  priceChangePercent?: number; // Price-only change (%): changes revenue & deductions, keeps physical CMV fixed
  demandChangePercent?: number; // Volume/demand change (%): changes revenue, deductions, CMV, and variable expenses proportionally
  variableCostChangePercent?: number; // CMV & variable expense unit cost change (%)
  fixedExpenseChangePercent?: number; // Fixed expense change (%)
  selicShockPercent?: number; // Delta in Selic/CDI in p.p. (e.g. +2 for +2 p.p.)
  debtExposureValue?: number; // Explicit floating debt base if debtFacilities not supplied
  cdiDebtExposureValue?: number; // Optional breakdown of CDI-indexed debt
  selicDebtExposureValue?: number; // Optional breakdown of Selic-indexed debt
  fixedDebtExposureValue?: number; // Optional breakdown of fixed-rate debt
  hasAmortizationSchedule?: boolean; // Whether an amortization schedule was provided
  priceElasticityHypothesis?: number; // Optional user-supplied elasticity hypothesis (never assumed silently!)
  newDebtAmount?: number; // Optional new financing principal
  newDebtAnnualRatePct?: number; // Annual rate (%) for new financing
  debtAmortizationAmount?: number; // Optional principal amortization reducing floating debt
  taxRegime?: string; // "Simples Nacional", "Lucro Presumido", "Lucro Real"
  applyLucroRealStatutoryEstimate?: boolean; // Only when true AND LALUR conditions are explicitly assumed, applies statutory IRPJ/CSLL estimate
  allowLucroRealTaxShieldEstimate?: boolean; // Alias for applyLucroRealStatutoryEstimate
  lalurTaxableIncome?: number; // Optional user-informed monthly LALUR taxable profit base
  debtFacilities?: DebtFacilityRecord[]; // Optional facility list for context
  scenarioLabel?: string;
}

export interface TaxImpactBreakdown {
  taxRegime: string;
  grossFinancialImpact: string;
  estimatedTaxEffect: string;
  netFinancialImpact: string;
  taxShieldStatus: 'NAO_APLICAVEL_SIMPLES' | 'NAO_APLICAVEL_PRESUMIDO' | 'NAO_MODELADO_SEM_LALUR' | 'ESTIMADO_LALUR_ESTATUTARIO' | 'SEM_EFEITO_EM_PREJUIZO';
  explanation: string;
  lucroRealStatutoryReference?: {
    irpj15PctDelta: string;
    irpjAdditional10PctDelta: string;
    csll9PctDelta: string;
    totalPotentialTaxEffect: string;
    potentialNetProfitWithTaxShield: string;
    conditions: string;
  };
}

export interface ExplainedScenarioResult {
  scenarioLabel: string;
  taxRegime: string;
  baseNetRevenue: string;
  simulatedNetRevenue: string;
  baseCmv: string;
  simulatedCmv: string;
  baseContributionMargin: string;
  simulatedContributionMargin: string;
  baseFixedExpenses: string;
  simulatedFixedExpenses: string;
  baseOperatingResult: string;
  simulatedOperatingResult: string;
  baseFinancialResult: string;
  simulatedFinancialResult: string;
  baseLair: string;
  simulatedLair: string;
  baseTaxes: string;
  simulatedTaxes: string;
  baseNetProfit: string;
  simulatedNetProfit: string;
  baseOperatingBreakEven: string;
  simulatedOperatingBreakEven: string;
  netRevenueDiff: string;
  operatingResultDiff: string;
  grossFinancialImpact: string;
  annualizedGrossInterestImpact: string;
  estimatedTaxEffect: string;
  netFinancialImpact: string;
  netProfitDiff: string;
  taxEffectStatus: TaxImpactBreakdown['taxShieldStatus'];
  taxMethodologyNote: string;
  taxBreakdown: TaxImpactBreakdown;
  driverAttribution: Array<{ driver: string; impactOnNetProfit: string }>;
  assumptions: string[];
  formulas: string[];
  limitations: string[];
}

/**
 * Computes statutory IRPJ (15%), Additional IRPJ (10% above R$ 20,000/month), and CSLL (9%)
 * for a given monthly taxable profit in Lucro Real.
 */
export function computeLucroRealStatutoryMonthlyTax(monthlyTaxableProfit: Decimal): {
  irpj15: Decimal;
  irpjAdditional10: Decimal;
  csll9: Decimal;
  total: Decimal;
  irpjBasic: Decimal;
  irpjAdditional: Decimal;
  csll: Decimal;
  totalTax: Decimal;
} {
  if (monthlyTaxableProfit.lte(0)) {
    const zero = new Decimal(0);
    return {
      irpj15: zero,
      irpjAdditional10: zero,
      csll9: zero,
      total: zero,
      irpjBasic: zero,
      irpjAdditional: zero,
      csll: zero,
      totalTax: zero,
    };
  }
  const irpj15 = monthlyTaxableProfit.times('0.15');
  const excessOver20k = Decimal.max(0, monthlyTaxableProfit.minus(20000));
  const irpjAdditional10 = excessOver20k.times('0.10');
  const csll9 = monthlyTaxableProfit.times('0.09');
  const total = irpj15.plus(irpjAdditional10).plus(csll9);
  return {
    irpj15,
    irpjAdditional10,
    csll9,
    total,
    irpjBasic: irpj15,
    irpjAdditional: irpjAdditional10,
    csll: csll9,
    totalTax: total,
  };
}

export function simulateScenario(baseDre: CalculatedDRE, input: ScenarioInput): ExplainedScenarioResult {
  const taxRegime = input.taxRegime || baseDre.taxRegime || 'Simples Nacional';
  const pricePct = new Decimal(input.priceChangePercent || 0);
  const demandPct = new Decimal(input.demandChangePercent || 0);
  const vcPct = new Decimal(input.variableCostChangePercent || 0);
  const fePct = new Decimal(input.fixedExpenseChangePercent || 0);

  let effectiveDemandPct = demandPct;
  const assumptions: string[] = [];
  const limitations: string[] = [
    'Simulação estática mensal (não projeta efeito composto de capital de giro ou sazonalidade multi-mês).',
    'Os cenários representam análises condicionais às premissas informadas e não constituem previsão contratual nem garantia de desempenho futuro.',
  ];

  if (!pricePct.isZero() && demandPct.isZero() && input.priceElasticityHypothesis !== undefined && input.priceElasticityHypothesis !== 0) {
    effectiveDemandPct = pricePct.times(input.priceElasticityHypothesis);
    assumptions.push(
      `HIPÓTESE DO USUÁRIO: Elasticidade-preço informada de ${input.priceElasticityHypothesis} aplicou variação induzida de demanda de ${effectiveDemandPct.toFixed(2)}% sobre variação de preço de ${pricePct.toFixed(2)}%.`
    );
  } else if (!pricePct.isZero() && demandPct.isZero()) {
    assumptions.push(
      'Variação de preço simulada mantendo volume físico constante (não assumimos elasticidade-preço sem dados históricos ou hipótese informada).'
    );
  }

  const priceFactor = new Decimal(1).plus(pricePct.dividedBy(100));
  const demandFactor = new Decimal(1).plus(effectiveDemandPct.dividedBy(100));
  const vcFactor = new Decimal(1).plus(vcPct.dividedBy(100));
  const feFactor = new Decimal(1).plus(fePct.dividedBy(100));

  // Combined revenue factor: Price * Demand
  const revenueFactor = priceFactor.times(demandFactor);
  const simulatedGrossRevenue = baseDre.grossRevenue.times(revenueFactor);

  // Deductions (e.g. DAS / ICMS / PIS / COFINS) scale proportionally with Gross Revenue within current bracket
  const effectiveDeductionRatio = baseDre.grossRevenue.isZero()
    ? new Decimal(0)
    : baseDre.deductions.dividedBy(baseDre.grossRevenue);
  const simulatedDeductions = simulatedGrossRevenue.times(effectiveDeductionRatio);
  const simulatedNetRevenue = simulatedGrossRevenue.minus(simulatedDeductions);

  // CMV scales with Demand (physical volume) and Variable Cost factor (unit cost), NOT with pure Price changes
  const simulatedCmv = baseDre.cmv.times(demandFactor).times(vcFactor);

  // Variable selling expenses (e.g. card fees, commissions) scale with Revenue factor & VC factor
  const simulatedVariableExpenses = baseDre.variableExpenses.times(revenueFactor).times(vcFactor);

  const simulatedContributionMargin = simulatedNetRevenue.minus(simulatedCmv).minus(simulatedVariableExpenses);
  const simulatedFixedExpenses = baseDre.fixedExpenses.times(feFactor);

  // Financial expenses impact from Selic/CDI shock + optional debt changes
  let simulatedFinancialExpenses = baseDre.financialExpenses;
  const exposedDebt = new Decimal(input.debtExposureValue || 0);
  const amortization = new Decimal(input.debtAmortizationAmount || 0);
  const effectiveFloatingDebt = Decimal.max(0, exposedDebt.minus(amortization));

  let monthlyInterestDelta = new Decimal(0);
  if (input.selicShockPercent && effectiveFloatingDebt.gt(0)) {
    const shockDeltaAnnual = effectiveFloatingDebt.times(new Decimal(input.selicShockPercent).dividedBy(100));
    const shockDeltaMonthly = shockDeltaAnnual.dividedBy(12);
    monthlyInterestDelta = monthlyInterestDelta.plus(shockDeltaMonthly);

    const cdiPart = input.cdiDebtExposureValue !== undefined ? `CDI: R$ ${new Decimal(input.cdiDebtExposureValue).toFixed(2)}` : null;
    const selicPart = input.selicDebtExposureValue !== undefined ? `Selic: R$ ${new Decimal(input.selicDebtExposureValue).toFixed(2)}` : null;
    const fixedPart = input.fixedDebtExposureValue !== undefined ? `Pré-fixada imune: R$ ${new Decimal(input.fixedDebtExposureValue).toFixed(2)}` : null;
    const breakdownText = [cdiPart, selicPart, fixedPart].filter(Boolean).join(' | ');

    assumptions.push(
      `Choque hipotético de juros de ${input.selicShockPercent > 0 ? '+' : ''}${input.selicShockPercent} p.p. a.a. aplicado sobre exposição variável identificada de R$ ${effectiveFloatingDebt.toFixed(2)}${breakdownText ? ` (${breakdownText})` : ''}: impacto bruto estimado de R$ ${shockDeltaMonthly.toFixed(2)}/mês (R$ ${shockDeltaAnnual.toFixed(2)}/ano).`
    );
    assumptions.push(
      'Hipóteses do choque de juros: (1) saldo devedor constante no período; (2) exposição integral por 12 meses para o valor anualizado; (3) transmissão de 1:1 do choque em pontos percentuais tanto para contratos indexados à Selic quanto ao CDI.'
    );
    if (!input.hasAmortizationSchedule) {
      limitations.push(
        'Não há cronograma contratual de amortização cadastrado: o cálculo assume saldo devedor constante e não constitui previsão contratual de parcelas.'
      );
    }
    limitations.push(
      'Distinção técnica CDI vs. Selic: contratos em CDI seguem a taxa DI interbancária (Série BCB 4389, base 252 dias úteis), enquanto contratos em Selic seguem a taxa Selic (Série BCB 432). A transmissão de 1:1 é uma hipótese simplificadora de sensibilidade.'
    );
  } else if (input.selicShockPercent && effectiveFloatingDebt.isZero()) {
    assumptions.push(
      `Choque de juros de ${input.selicShockPercent > 0 ? '+' : ''}${input.selicShockPercent} p.p. informado, porém a exposição variável identificada é R$ 0,00 (nenhuma dívida pós-fixada ativa ou informada): impacto financeiro = R$ 0,00.`
    );
  }

  if (input.newDebtAmount && input.newDebtAmount > 0 && input.newDebtAnnualRatePct) {
    const newMonthlyInterest = new Decimal(input.newDebtAmount)
      .times(new Decimal(input.newDebtAnnualRatePct).dividedBy(100))
      .dividedBy(12);
    monthlyInterestDelta = monthlyInterestDelta.plus(newMonthlyInterest);
    assumptions.push(
      `Nova captação simulada de R$ ${input.newDebtAmount.toFixed(2)} a ${input.newDebtAnnualRatePct}% a.a. (+R$ ${newMonthlyInterest.toFixed(2)}/mês em despesas financeiras).`
    );
  }

  simulatedFinancialExpenses = Decimal.max(0, simulatedFinancialExpenses.plus(monthlyInterestDelta));

  const simulatedOperatingResult = simulatedContributionMargin.minus(simulatedFixedExpenses);
  const simulatedEbit = simulatedOperatingResult.minus(baseDre.depreciation);
  const simulatedFinancialResult = baseDre.financialRevenues.minus(simulatedFinancialExpenses);
  const simulatedLair = simulatedEbit.plus(simulatedFinancialResult);

  // Gross financial result change (negative when financial expenses increase)
  const grossFinancialImpact = simulatedFinancialResult.minus(baseDre.financialResult);

  // Regime-specific tax calculation (NEVER using baseDre.taxes / baseDre.lair as marginal rate!)
  let simulatedTaxes = baseDre.taxes;
  let taxShieldOnFinancialDelta = new Decimal(0);
  let taxShieldStatus: TaxImpactBreakdown['taxShieldStatus'] = 'NAO_APLICAVEL_SIMPLES';
  let taxExplanation = '';
  let lucroRealStatutoryReference: TaxImpactBreakdown['lucroRealStatutoryReference'] | undefined;

  if (taxRegime === 'Simples Nacional') {
    // Simples Nacional: No IRPJ/CSLL tax shield on financial or operating expenses.
    // DAS is modeled in deductions over Gross Revenue.
    simulatedTaxes = baseDre.taxes;
    taxShieldStatus = 'NAO_APLICAVEL_SIMPLES';
    taxExplanation =
      'Simples Nacional: o DAS incide sobre a receita bruta (deduções). Variações de despesas financeiras ou operacionais não geram escudo fiscal de IRPJ/CSLL (R$ 0,00).';
    assumptions.push(taxExplanation);
    limitations.push(
      'Simples Nacional: mantém-se a alíquota efetiva atual sobre o faturamento nas deduções; não se assume mudança de faixa progressiva sem histórico completo de RBT12 e Anexo.'
    );
  } else if (taxRegime === 'Lucro Presumido') {
    // Lucro Presumido: Tax base is presumed from Gross Revenue (+ financial revenues), NOT from LAIR!
    // Financial expenses and operating expenses do NOT reduce IRPJ/CSLL in Lucro Presumido.
    taxShieldStatus = 'NAO_APLICAVEL_PRESUMIDO';
    if (!simulatedGrossRevenue.equals(baseDre.grossRevenue) && baseDre.grossRevenue.gt(0) && baseDre.taxes.gt(0)) {
      // Scale presumed taxes strictly with Gross Revenue variation (never with LAIR or interest expenses!)
      simulatedTaxes = Decimal.max(0, baseDre.taxes.times(revenueFactor));
      taxExplanation =
        'Lucro Presumido: IRPJ/CSLL incidem sobre a base presumida de faturamento (e receitas financeiras), sem dedutibilidade de despesas financeiras ou operacionais. Nenhum escudo fiscal aplicado sobre juros.';
    } else {
      simulatedTaxes = baseDre.taxes;
      taxExplanation =
        'Lucro Presumido: aumento de despesas financeiras ou custos não reduz a base presumida de IRPJ/CSLL (escudo fiscal = R$ 0,00).';
    }
    assumptions.push(taxExplanation);
    limitations.push(
      'Lucro Presumido: não se utiliza a razão impostos/LAIR como alíquota marginal. A tributação depende dos percentuais de presunção da atividade (ex.: 8% IRPJ / 12% CSLL no comércio) e das receitas financeiras tributáveis.'
    );
  } else {
    // Lucro Real
    // Differentiate IRPJ (15%), Additional IRPJ (10% above R$ 20k/month), and CSLL (9%).
    // Do NOT assume baseDre.taxes / baseDre.lair as marginal rate, nor blindly apply 34% without LALUR context.
    const applyStatutoryEstimate = Boolean(
      input.applyLucroRealStatutoryEstimate || input.allowLucroRealTaxShieldEstimate
    );
    const baseTaxableProfit =
      input.lalurTaxableIncome !== undefined ? new Decimal(input.lalurTaxableIncome) : baseDre.lair;
    const simulatedTaxableProfit = baseTaxableProfit.plus(simulatedLair.minus(baseDre.lair));

    const baseStatutory = computeLucroRealStatutoryMonthlyTax(baseTaxableProfit);
    const simStatutory = computeLucroRealStatutoryMonthlyTax(simulatedTaxableProfit);
    const statutoryTaxDelta = simStatutory.total.minus(baseStatutory.total); // negative if simulatedTaxableProfit < baseTaxableProfit
    const potentialTaxBenefit = baseStatutory.total.minus(simStatutory.total); // positive if tax decreases

    lucroRealStatutoryReference = {
      irpj15PctDelta: simStatutory.irpj15.minus(baseStatutory.irpj15).toFixed(2),
      irpjAdditional10PctDelta: simStatutory.irpjAdditional10.minus(baseStatutory.irpjAdditional10).toFixed(2),
      csll9PctDelta: simStatutory.csll9.minus(baseStatutory.csll9).toFixed(2),
      totalPotentialTaxEffect: potentialTaxBenefit.toFixed(2),
      potentialNetProfitWithTaxShield: simulatedLair.minus(Decimal.max(0, baseDre.taxes.plus(statutoryTaxDelta))).toFixed(2),
      conditions:
        'Estimativa estatutária de referência (IRPJ 15% + Adicional 10% sobre parcela do lucro real > R$ 20.000/mês + CSLL 9%), condicionada à existência de lucro real tributável no LALUR, dedutibilidade integral da despesa e ausência de trava de 30% de prejuízos fiscais.',
    };

    if (simulatedTaxableProfit.lte(0) && baseTaxableProfit.lte(0)) {
      simulatedTaxes = baseDre.lair.lte(0) ? new Decimal(0) : baseDre.taxes;
      taxShieldStatus = 'SEM_EFEITO_EM_PREJUIZO';
      taxExplanation =
        'Lucro Real em prejuízo (LALUR/LAIR <= 0): não há imposto corrente adicional nem benefício fiscal imediato sobre aumento de despesas financeiras sem base tributável positiva.';
      assumptions.push(taxExplanation);
    } else if (applyStatutoryEstimate) {
      simulatedTaxes = simulatedTaxableProfit.gt(0)
        ? Decimal.max(0, baseDre.taxes.plus(statutoryTaxDelta))
        : new Decimal(0);
      // Estimate portion of tax effect attributable to financial result variation when in positive profit
      if (!grossFinancialImpact.isZero() && baseTaxableProfit.gt(0) && simulatedTaxableProfit.gt(0)) {
        const lalurWithOnlyFinChange = baseTaxableProfit.plus(grossFinancialImpact);
        const taxWithOnlyFinChange = computeLucroRealStatutoryMonthlyTax(lalurWithOnlyFinChange).total;
        taxShieldOnFinancialDelta = baseStatutory.total.minus(taxWithOnlyFinChange);
      }
      taxShieldStatus = 'ESTIMADO_LALUR_ESTATUTARIO';
      taxExplanation =
        'Lucro Real (estimativa estatutária parametrizada): aplicado diferencial de IRPJ (15%), Adicional de IRPJ (10% acima de R$ 20 mil/mês) e CSLL (9%) sob hipótese explícita de lucro real tributável no LALUR.';
      assumptions.push(taxExplanation);
    } else {
      // Conservative default when LALUR additions/exclusions are not provided:
      // Present gross impact in Net Profit if LAIR > 0 (or zero tax if LAIR <= 0), and report statutory tax shield separately as unmodeled/conditional reference.
      simulatedTaxes = simulatedLair.gt(0) ? baseDre.taxes : new Decimal(0);
      taxShieldStatus = 'NAO_MODELADO_SEM_LALUR';
      taxExplanation =
        'Lucro Real: o impacto nos juros/resultado é apresentado pelo valor bruto na DRE simulada (efeito fiscal não abatido automaticamente por ausência de dados do LALUR: adições, exclusões e prejuízos fiscais). Consulte a referência estatutária condicional (IRPJ 15% + Adicional 10% + CSLL 9%).';
      assumptions.push(taxExplanation);
    }

    limitations.push(
      'Lucro Real: a dedutibilidade efetiva de juros e o benefício fiscal dependem de escrituração no LALUR/LACS, limite de R$ 20.000/mês para adicional de 10% do IRPJ e trava de 30% na compensação de prejuízos fiscais.'
    );
  }

  const simulatedNetProfit = simulatedLair.minus(simulatedTaxes);

  const simCmRatio = simulatedNetRevenue.isZero()
    ? new Decimal(0)
    : simulatedContributionMargin.dividedBy(simulatedNetRevenue);
  const simulatedOperatingBreakEven = simCmRatio.lte(0) ? new Decimal(0) : simulatedFixedExpenses.dividedBy(simCmRatio);

  // Driver attribution (waterfall)
  const cmDiff = simulatedContributionMargin.minus(baseDre.contributionMargin);
  const fixedDiff = baseDre.fixedExpenses.minus(simulatedFixedExpenses); // positive when fixed decreases
  const finDiff = grossFinancialImpact;
  const taxDiff = baseDre.taxes.minus(simulatedTaxes); // positive when taxes decrease
  const netFinancialImpact = finDiff.plus(taxShieldOnFinancialDelta);
  const annualizedGrossInterestImpact = finDiff.times(12);

  const taxBreakdown: TaxImpactBreakdown = {
    taxRegime,
    grossFinancialImpact: finDiff.toFixed(2),
    estimatedTaxEffect: taxDiff.toFixed(2),
    netFinancialImpact: netFinancialImpact.toFixed(2),
    taxShieldStatus,
    explanation: taxExplanation,
    ...(lucroRealStatutoryReference ? { lucroRealStatutoryReference } : {}),
  };

  const driverAttribution = [
    { driver: 'Variação na Margem de Contribuição (Preço / Volume / CMV)', impactOnNetProfit: cmDiff.toFixed(2) },
    { driver: 'Variação nas Despesas Fixas Operacionais', impactOnNetProfit: fixedDiff.toFixed(2) },
    { driver: 'Impacto Bruto no Resultado Financeiro (Juros / Selic / CDI)', impactOnNetProfit: finDiff.toFixed(2) },
    { driver: `Efeito Tributário sobre IRPJ/CSLL (${taxRegime})`, impactOnNetProfit: taxDiff.toFixed(2) },
  ];

  return {
    scenarioLabel: input.scenarioLabel || 'Cenário Simulado',
    taxRegime,
    baseNetRevenue: baseDre.netRevenue.toFixed(2),
    simulatedNetRevenue: simulatedNetRevenue.toFixed(2),
    baseCmv: baseDre.cmv.toFixed(2),
    simulatedCmv: simulatedCmv.toFixed(2),
    baseContributionMargin: baseDre.contributionMargin.toFixed(2),
    simulatedContributionMargin: simulatedContributionMargin.toFixed(2),
    baseFixedExpenses: baseDre.fixedExpenses.toFixed(2),
    simulatedFixedExpenses: simulatedFixedExpenses.toFixed(2),
    baseOperatingResult: baseDre.operatingResult.toFixed(2),
    simulatedOperatingResult: simulatedOperatingResult.toFixed(2),
    baseFinancialResult: baseDre.financialResult.toFixed(2),
    simulatedFinancialResult: simulatedFinancialResult.toFixed(2),
    baseLair: baseDre.lair.toFixed(2),
    simulatedLair: simulatedLair.toFixed(2),
    baseTaxes: baseDre.taxes.toFixed(2),
    simulatedTaxes: simulatedTaxes.toFixed(2),
    baseNetProfit: baseDre.netProfit.toFixed(2),
    simulatedNetProfit: simulatedNetProfit.toFixed(2),
    baseOperatingBreakEven: baseDre.operatingBreakEven.toFixed(2),
    simulatedOperatingBreakEven: simulatedOperatingBreakEven.toFixed(2),
    netRevenueDiff: simulatedNetRevenue.minus(baseDre.netRevenue).toFixed(2),
    operatingResultDiff: simulatedOperatingResult.minus(baseDre.operatingResult).toFixed(2),
    grossFinancialImpact: finDiff.toFixed(2),
    annualizedGrossInterestImpact: annualizedGrossInterestImpact.toFixed(2),
    estimatedTaxEffect: taxDiff.toFixed(2),
    netFinancialImpact: netFinancialImpact.toFixed(2),
    netProfitDiff: simulatedNetProfit.minus(baseDre.netProfit).toFixed(2),
    taxEffectStatus: taxShieldStatus,
    taxMethodologyNote: taxExplanation,
    taxBreakdown,
    driverAttribution,
    assumptions,
    formulas: [
      'Receita Bruta Simulada = Receita Bruta Base × (1 + ΔPreço%) × (1 + ΔDemanda%)',
      'Deduções Simuladas = Receita Bruta Simulada × (Deduções Base / Receita Bruta Base)',
      'CMV Simulado = CMV Base × (1 + ΔDemanda%) × (1 + ΔCustoVariável%)',
      'Impacto Bruto Mensal de Juros = Exposição Pós-Fixada Efetiva × (ΔJuros p.p. / 100) / 12',
      'Impacto Bruto Anualizado de Juros = Exposição Pós-Fixada Efetiva × (ΔJuros p.p. / 100) [sob hipótese de saldo constante por 12 meses]',
    ],
    limitations,
  };
}

export function simulateInterestRateWithFacilities(
  baseDre: CalculatedDRE,
  debtFacilities: DebtFacilityRecord[],
  currentSelicPct: number,
  targetSelicPct: number
) {
  const deltaSelic = new Decimal(targetSelicPct).minus(currentSelicPct).toNumber();
  const cdiDebt = debtFacilities
    .filter(f => f.indexer === 'CDI')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));
  const selicDebt = debtFacilities
    .filter(f => f.indexer === 'SELIC')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));
  const exposedDebt = cdiDebt.plus(selicDebt);

  const fixedDebt = debtFacilities
    .filter(f => f.indexer === 'PRE_FIXADO' || f.indexer === 'IPCA')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));

  const sim = simulateScenario(baseDre, {
    scenarioLabel: `Choque de Juros (Selic/CDI): ${currentSelicPct}% -> ${targetSelicPct}% a.a.`,
    selicShockPercent: deltaSelic,
    debtExposureValue: exposedDebt.toNumber(),
    cdiDebtExposureValue: cdiDebt.toNumber(),
    selicDebtExposureValue: selicDebt.toNumber(),
    fixedDebtExposureValue: fixedDebt.toNumber(),
    hasAmortizationSchedule: false,
    taxRegime: baseDre.taxRegime,
  });

  const annualizedGrossImpact = exposedDebt.times(new Decimal(deltaSelic).dividedBy(100));
  const monthlyGrossImpact = annualizedGrossImpact.dividedBy(12);

  return {
    ...sim,
    currentSelicPct,
    targetSelicPct,
    selicDeltaPct: deltaSelic,
    cdiIndexedDebt: cdiDebt.toFixed(2),
    selicIndexedDebt: selicDebt.toFixed(2),
    exposedFloatingDebt: exposedDebt.toFixed(2),
    unaffectedFixedOrIpcaDebt: fixedDebt.toFixed(2),
    monthlyGrossInterestImpact: monthlyGrossImpact.toFixed(2),
    annualizedInterestImpact: annualizedGrossImpact.toFixed(2),
  };
}

export function buildScenarioComparisonSuite(
  baseDre: CalculatedDRE,
  debtFacilities: DebtFacilityRecord[],
  customInput?: ScenarioInput
) {
  const cdiDebt = debtFacilities
    .filter(f => f.indexer === 'CDI')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));
  const selicDebt = debtFacilities
    .filter(f => f.indexer === 'SELIC')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));
  const fixedDebt = debtFacilities
    .filter(f => f.indexer === 'PRE_FIXADO' || f.indexer === 'IPCA')
    .reduce((acc, f) => acc.plus(f.outstandingBalance), new Decimal(0));
  const floatingDebt = cdiDebt.plus(selicDebt);

  const debtBase = customInput?.debtExposureValue !== undefined ? customInput.debtExposureValue : floatingDebt.toNumber();
  const commonDebtMeta = {
    cdiDebtExposureValue: cdiDebt.toNumber(),
    selicDebtExposureValue: selicDebt.toNumber(),
    fixedDebtExposureValue: fixedDebt.toNumber(),
    hasAmortizationSchedule: false,
    taxRegime: customInput?.taxRegime || baseDre.taxRegime,
  };

  const original = simulateScenario(baseDre, {
    scenarioLabel: 'Situação Original (Observada)',
    ...commonDebtMeta,
  });

  const optimistic = simulateScenario(baseDre, {
    scenarioLabel: 'Cenário Hipotético de Expansão (Demanda +8%, Custo -2%, Juros -1 p.p.)',
    demandChangePercent: 8,
    variableCostChangePercent: -2,
    selicShockPercent: -1,
    debtExposureValue: debtBase,
    ...commonDebtMeta,
  });

  const baseCase = simulateScenario(baseDre, {
    scenarioLabel: 'Cenário-Base Parametrizado (Usuário)',
    ...customInput,
    debtExposureValue: debtBase,
    ...commonDebtMeta,
  });

  const adverse = simulateScenario(baseDre, {
    scenarioLabel: 'Cenário Hipotético Adverso (Demanda -10%, Custo +5%, Juros +2,5 p.p.)',
    demandChangePercent: -10,
    variableCostChangePercent: 5,
    fixedExpenseChangePercent: 3,
    selicShockPercent: 2.5,
    debtExposureValue: debtBase,
    ...commonDebtMeta,
  });

  return {
    disclaimer:
      'Os cenários comparados são projeções condicionais às premissas declaradas (incluindo saldo devedor constante e transmissão 1:1 entre Selic e CDI) e não representam previsões contratuais ou garantidas.',
    debtBreakdown: {
      cdiIndexedDebt: cdiDebt.toFixed(2),
      selicIndexedDebt: selicDebt.toFixed(2),
      exposedFloatingDebt: floatingDebt.toFixed(2),
      fixedOrIpcaDebt: fixedDebt.toFixed(2),
    },
    scenarios: {
      original,
      optimistic,
      baseCase,
      adverse,
    },
  };
}
