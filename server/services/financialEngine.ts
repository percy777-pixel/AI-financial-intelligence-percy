import Decimal from 'decimal.js';

export interface RawFinancialInput {
  grossRevenue: number | string;
  deductions?: number | string | null;
  cmv: number | string;
  variableExpenses?: number | string | null;
  fixedExpenses: number | string;
  depreciation?: number | string | null;
  financialRevenues?: number | string | null;
  financialExpenses?: number | string | null;
  taxes?: number | string | null;
  taxRegime?: string; // "Simples Nacional", "Lucro Presumido", "Lucro Real"
  cashAndEquivalents?: number | string | null;
  accountsReceivable?: number | string | null;
  inventory?: number | string | null;
  accountsPayable?: number | string | null;
  currentAssets?: number | string | null;
  currentLiabilities?: number | string | null;
  totalAssets?: number | string | null;
  totalDebt?: number | string | null;
  shortTermDebt?: number | string | null;
  longTermDebt?: number | string | null;
  equity?: number | string | null;
  salesVolume?: number | string | null;
  averageTicket?: number | string | null;
  periodDays?: number;
}

export interface CalculatedDRE {
  grossRevenue: Decimal;
  deductions: Decimal;
  netRevenue: Decimal;
  cmv: Decimal;
  grossProfit?: Decimal;
  variableExpenses: Decimal;
  contributionMargin: Decimal;
  contributionMarginPercentage: Decimal;
  fixedExpenses: Decimal;
  operatingResult: Decimal; // Resultado Operacional Gerencial de Caixa (antes de D&A)
  operatingResultPercentage: Decimal;
  depreciation: Decimal;
  ebit: Decimal;
  ebitda: Decimal;
  financialRevenues: Decimal;
  financialExpenses: Decimal;
  financialResult: Decimal;
  lair: Decimal;
  taxes: Decimal;
  netProfit: Decimal;
  netProfitPercentage: Decimal;
  operatingBreakEven: Decimal;
  financialBreakEven: Decimal;
  safetyMargin: Decimal;
  taxRegime?: string;
  missingFields?: string[];
  taxNote?: string;
}

export interface FinancialIndicators {
  grossMargin: Decimal | null;
  contributionMarginRatio: Decimal;
  operatingMargin: Decimal;
  ebitdaMargin: Decimal;
  netMargin: Decimal;
  currentLiquidity: Decimal | null;
  quickLiquidity: Decimal | null;
  cashRatio: Decimal | null;
  debtToAssets: Decimal | null;
  debtToEquity: Decimal | null;
  interestCoverage: Decimal | null;
  roe: Decimal | null;
  roa: Decimal | null;
  inventoryTurnoverDays: Decimal | null;
  receivablesDays: Decimal | null;
  payablesDays: Decimal | null;
  cashConversionCycle: Decimal | null;
  interpretations: Record<string, string>;
  missingInformation: Array<{ field: string; impacts: string }>;
}

export interface FinancialValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingFields: Array<{ field: string; category: string; impact: string }>;
  completenessPct: number;
}

export interface StrictParseResult {
  status: 'VALID' | 'EMPTY' | 'INVALID' | 'AMBIGUOUS';
  decimal: Decimal | null;
  normalizedString: string | null;
  reason?: string;
}

/**
 * Strictly parses financial values in Brazilian (pt-BR) and US/standard formats
 * without silently multiplying, dividing, or inventing numbers.
 */
export function parseFinancialValueStrict(val: unknown): StrictParseResult {
  if (val === undefined || val === null) {
    return { status: 'EMPTY', decimal: null, normalizedString: null };
  }

  if (typeof val === 'boolean') {
    return {
      status: 'INVALID',
      decimal: null,
      normalizedString: null,
      reason: 'Valor booleano não é válido para campo financeiro.',
    };
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return {
        status: 'INVALID',
        decimal: null,
        normalizedString: null,
        reason: 'Número não finito (NaN ou Infinity).',
      };
    }
    const dec = new Decimal(val);
    return {
      status: 'VALID',
      decimal: dec,
      normalizedString: dec.toString(),
    };
  }

  if (val instanceof Decimal) {
    if (val.isNaN() || !val.isFinite()) {
      return {
        status: 'INVALID',
        decimal: null,
        normalizedString: null,
        reason: 'Decimal inválido.',
      };
    }
    return {
      status: 'VALID',
      decimal: val,
      normalizedString: val.toString(),
    };
  }

  if (typeof val !== 'string') {
    return {
      status: 'INVALID',
      decimal: null,
      normalizedString: null,
      reason: 'Tipo de dado inválido para conversão financeira.',
    };
  }

  const raw = val.trim();
  if (raw === '' || raw === '-' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') {
    return { status: 'EMPTY', decimal: null, normalizedString: null };
  }

  // Strip currency symbol "R$" and whitespace while preserving sign
  let cleaned = raw.replace(/R\$/gi, '').replace(/[\s\u00A0]/g, '');

  if (/^[+-]{2,}/.test(cleaned)) {
    return {
      status: 'INVALID',
      decimal: null,
      normalizedString: null,
      reason: `Sinal duplicado ou inválido em "${raw}".`,
    };
  }

  if (!/^[+-]?[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) {
    return {
      status: 'INVALID',
      decimal: null,
      normalizedString: null,
      reason: `Valor "${raw}" contém caracteres não numéricos inválidos.`,
    };
  }

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');

    if (lastComma > lastDot) {
      if (!/^[+-]?\d{1,3}(\.\d{3})+,\d+$/.test(cleaned)) {
        return {
          status: 'AMBIGUOUS',
          decimal: null,
          normalizedString: null,
          reason: `Valor "${raw}" possui agrupamento de milhar/decimal inconsistente (esperado ex.: 1.250,50).`,
        };
      }
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      if (!/^[+-]?\d{1,3}(,\d{3})+\.\d+$/.test(cleaned)) {
        return {
          status: 'AMBIGUOUS',
          decimal: null,
          normalizedString: null,
          reason: `Valor "${raw}" possui agrupamento de milhar/decimal inconsistente (esperado ex.: 1,250.50).`,
        };
      }
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    const commaParts = cleaned.split(',');
    if (commaParts.length > 2) {
      return {
        status: 'AMBIGUOUS',
        decimal: null,
        normalizedString: null,
        reason: `Valor "${raw}" contém múltiplas vírgulas sem separador decimal explícito.`,
      };
    }
    if (!/^[+-]?\d+,\d+$/.test(cleaned)) {
      return {
        status: 'INVALID',
        decimal: null,
        normalizedString: null,
        reason: `Valor "${raw}" possui vírgula decimal incompleta.`,
      };
    }
    cleaned = cleaned.replace(',', '.');
  } else if (hasDot) {
    const dotParts = cleaned.split('.');
    if (dotParts.length > 2) {
      return {
        status: 'AMBIGUOUS',
        decimal: null,
        normalizedString: null,
        reason: `Valor "${raw}" contém múltiplos pontos sem vírgula decimal (use ex.: 1250000 ou 1.250.000,00).`,
      };
    }
    if (!/^[+-]?\d+\.\d+$/.test(cleaned)) {
      return {
        status: 'INVALID',
        decimal: null,
        normalizedString: null,
        reason: `Valor "${raw}" possui ponto decimal incompleto.`,
      };
    }
    const intPart = dotParts[0].replace(/^[+-]/, '');
    const fracPart = dotParts[1];
    if (fracPart.length === 3 && intPart.length >= 1 && intPart.length <= 3 && intPart !== '0') {
      return {
        status: 'AMBIGUOUS',
        decimal: null,
        normalizedString: null,
        reason: `Valor "${raw}" é ambíguo entre milhar (1250) e decimal (1,25). Informe sem ponto de milhar (1250) ou com centavos (1.250,00).`,
      };
    }
  }

  try {
    const parsed = new Decimal(cleaned);
    if (parsed.isNaN() || !parsed.isFinite()) {
      return {
        status: 'INVALID',
        decimal: null,
        normalizedString: null,
        reason: `Não foi possível converter "${raw}" em Decimal válido.`,
      };
    }
    return {
      status: 'VALID',
      decimal: parsed,
      normalizedString: parsed.toString(),
    };
  } catch {
    return {
      status: 'INVALID',
      decimal: null,
      normalizedString: null,
      reason: `Erro ao converter "${raw}" em número financeiro.`,
    };
  }
}

/**
 * Parses numeric values or strings supporting both pt-BR ("1.250,50") and en-US ("1250.50").
 * Returns null if the value is absent, invalid, or ambiguous (never silently turns missing/invalid values into 0).
 */
export function parseOptionalDecimal(val: number | string | undefined | null): Decimal | null {
  const res = parseFinancialValueStrict(val);
  return res.status === 'VALID' ? res.decimal : null;
}

export function parseDecimal(val: number | string | undefined | null): Decimal {
  return parseOptionalDecimal(val) ?? new Decimal(0);
}

export function validateFinancialInput(input: Partial<RawFinancialInput>): FinancialValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFields: Array<{ field: string; category: string; impact: string }> = [];

  // First check all numeric fields for malformed or ambiguous strings
  const numericKeys: Array<{ key: keyof RawFinancialInput; label: string }> = [
    { key: 'grossRevenue', label: 'Receita Bruta (grossRevenue)' },
    { key: 'deductions', label: 'Deduções (deductions)' },
    { key: 'cmv', label: 'CMV/CPV (cmv)' },
    { key: 'variableExpenses', label: 'Despesas Variáveis (variableExpenses)' },
    { key: 'fixedExpenses', label: 'Despesas Fixas (fixedExpenses)' },
    { key: 'depreciation', label: 'Depreciação (depreciation)' },
    { key: 'financialRevenues', label: 'Receitas Financeiras (financialRevenues)' },
    { key: 'financialExpenses', label: 'Despesas Financeiras (financialExpenses)' },
    { key: 'taxes', label: 'Impostos sobre Resultado (taxes)' },
    { key: 'cashAndEquivalents', label: 'Caixa e Equivalentes (cashAndEquivalents)' },
    { key: 'accountsReceivable', label: 'Contas a Receber (accountsReceivable)' },
    { key: 'inventory', label: 'Estoque (inventory)' },
    { key: 'accountsPayable', label: 'Contas a Pagar (accountsPayable)' },
    { key: 'currentAssets', label: 'Ativo Circulante (currentAssets)' },
    { key: 'currentLiabilities', label: 'Passivo Circulante (currentLiabilities)' },
    { key: 'totalAssets', label: 'Ativo Total (totalAssets)' },
    { key: 'totalDebt', label: 'Dívida Total (totalDebt)' },
    { key: 'equity', label: 'Patrimônio Líquido (equity)' },
  ];

  for (const nk of numericKeys) {
    const rawVal = input[nk.key];
    if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
      const strict = parseFinancialValueStrict(rawVal);
      if (strict.status === 'INVALID' || strict.status === 'AMBIGUOUS') {
        errors.push(`Campo ${nk.label} contém valor inválido ou ambíguo ("${rawVal}"): ${strict.reason}`);
      }
    }
  }

  const grossRev = parseOptionalDecimal(input.grossRevenue);
  const deductions = parseOptionalDecimal(input.deductions);
  const cmv = parseOptionalDecimal(input.cmv);
  const varExp = parseOptionalDecimal(input.variableExpenses);
  const fixedExp = parseOptionalDecimal(input.fixedExpenses);
  const dep = parseOptionalDecimal(input.depreciation);
  const finRev = parseOptionalDecimal(input.financialRevenues);
  const finExp = parseOptionalDecimal(input.financialExpenses);
  const taxes = parseOptionalDecimal(input.taxes);

  if (grossRev === null) {
    errors.push('Receita Bruta (grossRevenue) é obrigatória e não foi informada ou é inválida.');
  } else if (grossRev.lt(0)) {
    errors.push('Receita Bruta não pode ser negativa.');
  }

  if (cmv === null) {
    errors.push('CMV/CPV (cmv) é obrigatório para cálculo de margem bruta e margem de contribuição.');
  } else if (cmv.lt(0)) {
    errors.push('CMV/CPV não pode ser negativo.');
  }

  if (fixedExp === null) {
    errors.push('Despesas Fixas Operacionais (fixedExpenses) são obrigatórias para ponto de equilíbrio e resultado operacional.');
  } else if (fixedExp.lt(0)) {
    warnings.push('Despesas Fixas negativas informadas; verifique se há estorno contábil atípico.');
  }

  if (grossRev && deductions && deductions.gt(grossRev)) {
    errors.push('Deduções sobre vendas excedem a Receita Bruta, gerando Receita Líquida negativa.');
  }

  if (deductions === null) {
    missingFields.push({
      field: 'deductions',
      category: 'DRE',
      impact: 'Impossibilita apurar Receita Líquida exata e carga tributária sobre vendas (ex.: DAS do Simples Nacional).',
    });
  }
  if (varExp === null) {
    missingFields.push({
      field: 'variableExpenses',
      category: 'DRE',
      impact: 'Margem de Contribuição não refletirá comissões, fretes e taxas de cartão.',
    });
  }
  if (dep === null) {
    missingFields.push({
      field: 'depreciation',
      category: 'DRE',
      impact: 'EBIT e Resultado Operacional Gerencial de Caixa ficam idênticos por ausência de D&A.',
    });
  }
  if (finRev === null || finExp === null) {
    missingFields.push({
      field: 'financialRevenues / financialExpenses',
      category: 'Resultado Financeiro',
      impact: 'Resultado financeiro e índice de cobertura de juros ficam incompletos.',
    });
  }

  if (input.taxRegime === 'Simples Nacional' && taxes && taxes.gt(0)) {
    warnings.push(
      'Regime Simples Nacional selecionado com imposto sobre resultado > 0: no Simples Nacional, IRPJ/CSLL normalmente integram o DAS nas deduções da receita bruta. Confirme se trata-se de ganho de capital ou tributo específico.'
    );
  }

  const balanceChecks: Array<{ key: keyof RawFinancialInput; label: string; impact: string }> = [
    { key: 'cashAndEquivalents', label: 'Disponibilidades / Caixa (cashAndEquivalents)', impact: 'Impede cálculo de Liquidez Imediata e reserva de caixa em dias.' },
    { key: 'accountsReceivable', label: 'Contas a Receber (accountsReceivable)', impact: 'Impede cálculo de PMR e Ciclo Financeiro.' },
    { key: 'inventory', label: 'Estoque (inventory)', impact: 'Impede cálculo de Giro/PME de Estoque e Liquidez Seca.' },
    { key: 'accountsPayable', label: 'Contas a Pagar / Fornecedores (accountsPayable)', impact: 'Impede cálculo de PMP e necessidade líquida de capital de giro.' },
    { key: 'currentAssets', label: 'Ativo Circulante (currentAssets)', impact: 'Impede cálculo de Liquidez Corrente.' },
    { key: 'currentLiabilities', label: 'Passivo Circulante (currentLiabilities)', impact: 'Impede cálculo de Liquidez Corrente e Liquidez Seca.' },
    { key: 'totalAssets', label: 'Ativo Total (totalAssets)', impact: 'Impede cálculo de Endividamento Geral e ROA.' },
    { key: 'totalDebt', label: 'Dívida Total (totalDebt)', impact: 'Impede cálculo de alavancagem total sem detalhamento de contratos.' },
    { key: 'equity', label: 'Patrimônio Líquido (equity)', impact: 'Impede cálculo de ROE e Dívida/PL.' },
  ];

  let populatedOptional = 0;
  for (const check of balanceChecks) {
    const val = parseOptionalDecimal(input[check.key] as any);
    if (val === null) {
      missingFields.push({ field: check.label, category: 'Balanço & Capital de Giro', impact: check.impact });
    } else {
      populatedOptional++;
    }
  }

  const totalTracked = 9 + balanceChecks.length;
  const populatedCore = [grossRev, deductions, cmv, varExp, fixedExp, dep, finRev, finExp, taxes].filter(v => v !== null).length;
  const completenessPct = Math.round(((populatedCore + populatedOptional) / totalTracked) * 100);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    missingFields,
    completenessPct,
  };
}

export function calculateDRE(input: RawFinancialInput): CalculatedDRE {
  const missingFields: string[] = [];
  const track = (key: string, val: number | string | undefined | null): Decimal => {
    const parsed = parseOptionalDecimal(val);
    if (parsed === null) {
      missingFields.push(key);
      return new Decimal(0);
    }
    return parsed;
  };

  const taxRegime = input.taxRegime || 'Simples Nacional';
  const grossRevenue = track('grossRevenue', input.grossRevenue);
  const deductions = track('deductions', input.deductions);
  const netRevenue = grossRevenue.minus(deductions);

  const cmv = track('cmv', input.cmv);
  const grossProfit = netRevenue.minus(cmv);
  const variableExpenses = track('variableExpenses', input.variableExpenses);

  // Margem de contribuição = receita líquida − CMV/CPV − despesas variáveis de venda
  const contributionMargin = netRevenue.minus(cmv).minus(variableExpenses);
  const contributionMarginPercentage = netRevenue.isZero()
    ? new Decimal(0)
    : contributionMargin.dividedBy(netRevenue).times(100);

  const fixedExpenses = track('fixedExpenses', input.fixedExpenses);

  // Resultado operacional gerencial de caixa = margem de contribuição − despesas fixas operacionais de caixa
  const operatingResult = contributionMargin.minus(fixedExpenses);
  const operatingResultPercentage = netRevenue.isZero()
    ? new Decimal(0)
    : operatingResult.dividedBy(netRevenue).times(100);

  const depreciation = track('depreciation', input.depreciation);

  // EBIT = resultado operacional gerencial de caixa − depreciação e amortização
  const ebit = operatingResult.minus(depreciation);

  // EBITDA = EBIT + depreciação e amortização
  const ebitda = ebit.plus(depreciation);

  const financialRevenues = track('financialRevenues', input.financialRevenues);
  const financialExpenses = track('financialExpenses', input.financialExpenses);
  const financialResult = financialRevenues.minus(financialExpenses);

  // LAIR = EBIT + resultado financeiro líquido
  const lair = ebit.plus(financialResult);

  // Tratamento de tributos sobre o resultado conforme regime tributário
  let taxes = parseOptionalDecimal(input.taxes);
  let taxNote = 'Impostos sobre o resultado (IRPJ/CSLL) apurados conforme regime tributário.';
  if (taxRegime === 'Simples Nacional') {
    if (taxes === null) {
      taxes = new Decimal(0);
      taxNote = 'Simples Nacional: tributação unificada (DAS) considerada nas deduções sobre receita bruta; IRPJ/CSLL sobre o lucro = R$ 0,00.';
    } else if (taxes.isZero()) {
      taxNote = 'Simples Nacional: DAS apurado sobre receita bruta nas deduções; sem imposto adicional sobre o resultado.';
    } else {
      taxNote = 'Simples Nacional com imposto adicional explícito sobre o resultado informado pelo usuário.';
    }
  } else if (taxRegime === 'Lucro Presumido') {
    if (taxes === null) {
      missingFields.push('taxes');
      taxes = new Decimal(0);
      taxNote = 'Lucro Presumido: IRPJ/CSLL sobre base presumida não informados (tratados como R$ 0,00 preliminarmente).';
    } else {
      taxNote = 'Lucro Presumido: IRPJ/CSLL apurados sobre base presumida de faturamento e receitas financeiras (despesas financeiras não geram escudo fiscal).';
    }
  } else {
    // Lucro Real
    if (taxes === null) {
      missingFields.push('taxes');
      taxes = new Decimal(0);
      taxNote = 'Lucro Real: IRPJ/CSLL não informados; tratados como R$ 0,00 apenas para fechamento contábil preliminar.';
    } else {
      taxNote = 'Lucro Real: IRPJ (15% + adicional 10% acima de R$ 20 mil/mês) e CSLL (9%) apurados conforme LALUR informado.';
    }
  }

  // Lucro líquido gerencial = LAIR − impostos sobre o resultado
  const netProfit = lair.minus(taxes);
  const netProfitPercentage = netRevenue.isZero()
    ? new Decimal(0)
    : netProfit.dividedBy(netRevenue).times(100);

  // Ponto de Equilíbrio Operacional = Despesas Fixas / Índice de Margem de Contribuição
  const cmRatio = netRevenue.isZero() ? new Decimal(0) : contributionMargin.dividedBy(netRevenue);
  const operatingBreakEven = cmRatio.lte(0) ? new Decimal(0) : fixedExpenses.dividedBy(cmRatio);

  // Ponto de Equilíbrio Financeiro
  const netFinCost = financialExpenses.minus(financialRevenues);
  const fixedPlusFinance = netFinCost.gt(0) ? fixedExpenses.plus(netFinCost) : fixedExpenses;
  const financialBreakEven = cmRatio.lte(0) ? new Decimal(0) : fixedPlusFinance.dividedBy(cmRatio);

  const safetyMargin = netRevenue.isZero()
    ? new Decimal(0)
    : netRevenue.minus(operatingBreakEven).dividedBy(netRevenue).times(100);

  return {
    grossRevenue,
    deductions,
    netRevenue,
    cmv,
    grossProfit,
    variableExpenses,
    contributionMargin,
    contributionMarginPercentage,
    fixedExpenses,
    operatingResult,
    operatingResultPercentage,
    depreciation,
    ebit,
    ebitda,
    financialRevenues,
    financialExpenses,
    financialResult,
    lair,
    taxes,
    netProfit,
    netProfitPercentage,
    operatingBreakEven,
    financialBreakEven,
    safetyMargin,
    taxRegime,
    missingFields,
    taxNote,
  };
}

export function calculateIndicators(dre: CalculatedDRE, input: RawFinancialInput): FinancialIndicators {
  const netRevenue = dre.netRevenue;
  const periodDays = new Decimal(input.periodDays || 30);
  const missingInformation: Array<{ field: string; impacts: string }> = [];

  // Gross Margin = (Net Revenue - CMV) / Net Revenue * 100
  const grossMargin = netRevenue.lte(0)
    ? null
    : netRevenue.minus(dre.cmv).dividedBy(netRevenue).times(100);
  const contributionMarginRatio = netRevenue.lte(0)
    ? new Decimal(0)
    : dre.contributionMargin.dividedBy(netRevenue).times(100);
  const operatingMargin = netRevenue.lte(0) ? new Decimal(0) : dre.operatingResultPercentage;
  const ebitdaMargin = netRevenue.lte(0) ? new Decimal(0) : dre.ebitda.dividedBy(netRevenue).times(100);
  const netMargin = netRevenue.lte(0) ? new Decimal(0) : dre.netProfitPercentage;

  const currentAssets = parseOptionalDecimal(input.currentAssets);
  const currentLiabilities = parseOptionalDecimal(input.currentLiabilities);
  const inventory = parseOptionalDecimal(input.inventory);
  const cash = parseOptionalDecimal(input.cashAndEquivalents);
  const receivables = parseOptionalDecimal(input.accountsReceivable);
  const payables = parseOptionalDecimal(input.accountsPayable);
  const totalAssets = parseOptionalDecimal(input.totalAssets);
  const totalDebt = parseOptionalDecimal(input.totalDebt);
  const equity = parseOptionalDecimal(input.equity);

  let currentLiquidity: Decimal | null = null;
  if (currentAssets !== null && currentLiabilities !== null && !currentLiabilities.isZero()) {
    currentLiquidity = currentAssets.dividedBy(currentLiabilities);
  } else {
    missingInformation.push({
      field: 'currentAssets / currentLiabilities',
      impacts: 'Liquidez Corrente indisponível',
    });
  }

  let quickLiquidity: Decimal | null = null;
  if (currentAssets !== null && inventory !== null && currentLiabilities !== null && !currentLiabilities.isZero()) {
    quickLiquidity = currentAssets.minus(inventory).dividedBy(currentLiabilities);
  } else {
    missingInformation.push({
      field: 'inventory (com currentAssets e currentLiabilities)',
      impacts: 'Liquidez Seca indisponível (crucial no varejo devido ao peso dos estoques)',
    });
  }

  let cashRatio: Decimal | null = null;
  if (cash !== null && currentLiabilities !== null && !currentLiabilities.isZero()) {
    cashRatio = cash.dividedBy(currentLiabilities);
  } else {
    missingInformation.push({
      field: 'cashAndEquivalents',
      impacts: 'Liquidez Imediata e reserva de caixa indisponíveis',
    });
  }

  let debtToAssets: Decimal | null = null;
  if (totalDebt !== null && totalAssets !== null && !totalAssets.isZero()) {
    debtToAssets = totalDebt.dividedBy(totalAssets).times(100);
  } else {
    missingInformation.push({
      field: 'totalDebt / totalAssets',
      impacts: 'Grau de Endividamento sobre Ativos indisponível',
    });
  }

  let debtToEquity: Decimal | null = null;
  if (totalDebt !== null && equity !== null && !equity.isZero()) {
    debtToEquity = totalDebt.dividedBy(equity).times(100);
  }

  let interestCoverage: Decimal | null = null;
  if (dre.financialExpenses.gt(0)) {
    interestCoverage = dre.ebit.dividedBy(dre.financialExpenses);
  }

  let roe: Decimal | null = null;
  if (equity !== null && !equity.isZero()) {
    roe = dre.netProfit.dividedBy(equity).times(100);
  } else {
    missingInformation.push({
      field: 'equity',
      impacts: 'ROE e alavancagem sobre Patrimônio Líquido indisponíveis',
    });
  }

  let roa: Decimal | null = null;
  if (totalAssets !== null && !totalAssets.isZero()) {
    roa = dre.netProfit.dividedBy(totalAssets).times(100);
  }

  let inventoryTurnoverDays: Decimal | null = null;
  if (inventory !== null && dre.cmv.gt(0)) {
    inventoryTurnoverDays = inventory.dividedBy(dre.cmv).times(periodDays);
  } else {
    missingInformation.push({
      field: 'inventory',
      impacts: 'Prazo Médio de Estocagem (PME) indisponível',
    });
  }

  let receivablesDays: Decimal | null = null;
  if (receivables !== null && dre.grossRevenue.gt(0)) {
    receivablesDays = receivables.dividedBy(dre.grossRevenue).times(periodDays);
  } else {
    missingInformation.push({
      field: 'accountsReceivable',
      impacts: 'Prazo Médio de Recebimento (PMR) indisponível',
    });
  }

  let payablesDays: Decimal | null = null;
  if (payables !== null && dre.cmv.gt(0)) {
    payablesDays = payables.dividedBy(dre.cmv).times(periodDays);
  } else {
    missingInformation.push({
      field: 'accountsPayable',
      impacts: 'Prazo Médio de Pagamento a Fornecedores (PMP) indisponível',
    });
  }

  let cashConversionCycle: Decimal | null = null;
  if (inventoryTurnoverDays !== null && receivablesDays !== null && payablesDays !== null) {
    cashConversionCycle = inventoryTurnoverDays.plus(receivablesDays).minus(payablesDays);
  } else {
    missingInformation.push({
      field: 'Ciclo Financeiro (PME + PMR - PMP)',
      impacts: 'Análise completa de capital de giro indisponível sem estoques, recebíveis e fornecedores',
    });
  }

  const interpretations: Record<string, string> = {};

  if (contributionMarginRatio.lt(30)) {
    interpretations['contributionMargin'] =
      'Margem de contribuição baixa (<30%), indicando pressão nos custos variáveis (CMV/comissões) ou preços de venda reduzidos.';
  } else {
    interpretations['contributionMargin'] =
      'Margem de contribuição saudável (>=30%), permitindo cobertura adequada das despesas fixas.';
  }

  if (operatingMargin.lt(0)) {
    interpretations['operatingResult'] =
      'Resultado operacional gerencial de caixa negativo. A operação corrente está consumindo caixa antes do serviço da dívida.';
  } else {
    interpretations['operatingResult'] =
      'Resultado operacional gerencial de caixa positivo, indicando geração operacional antes de D&A e juros.';
  }

  if (currentLiquidity !== null) {
    if (currentLiquidity.lt(1)) {
      interpretations['liquidity'] =
        'Liquidez corrente abaixo de 1.0x, sinalizando pressão de curto prazo para honrar obrigações.';
    } else if (quickLiquidity !== null && quickLiquidity.lt(0.8)) {
      interpretations['liquidity'] =
        'Liquidez corrente acima de 1.0x, porém Liquidez Seca baixa (<0.8x): alta dependência da realização de estoques.';
    } else {
      interpretations['liquidity'] = 'Liquidez corrente adequada para honrar compromissos de curto prazo.';
    }
  }

  if (cashConversionCycle !== null) {
    if (cashConversionCycle.gt(45)) {
      interpretations['workingCapital'] = `Ciclo financeiro longo (${cashConversionCycle.toFixed(1)} dias), exigindo financiamento contínuo de capital de giro.`;
    } else {
      interpretations['workingCapital'] = `Ciclo financeiro controlado (${cashConversionCycle.toFixed(1)} dias).`;
    }
  }

  return {
    grossMargin,
    contributionMarginRatio,
    operatingMargin,
    ebitdaMargin,
    netMargin,
    currentLiquidity,
    quickLiquidity,
    cashRatio,
    debtToAssets,
    debtToEquity,
    interestCoverage,
    roe,
    roa,
    inventoryTurnoverDays,
    receivablesDays,
    payablesDays,
    cashConversionCycle,
    interpretations,
    missingInformation,
  };
}

export function serializeDRE(dre: CalculatedDRE) {
  return {
    grossRevenue: dre.grossRevenue.toFixed(2),
    deductions: dre.deductions.toFixed(2),
    netRevenue: dre.netRevenue.toFixed(2),
    cmv: dre.cmv.toFixed(2),
    grossProfit: (dre.grossProfit ?? dre.netRevenue.minus(dre.cmv)).toFixed(2),
    variableExpenses: dre.variableExpenses.toFixed(2),
    contributionMargin: dre.contributionMargin.toFixed(2),
    contributionMarginPercentage: dre.contributionMarginPercentage.toFixed(2),
    fixedExpenses: dre.fixedExpenses.toFixed(2),
    operatingResult: dre.operatingResult.toFixed(2),
    operatingResultPercentage: dre.operatingResultPercentage.toFixed(2),
    depreciation: dre.depreciation.toFixed(2),
    ebit: dre.ebit.toFixed(2),
    ebitda: dre.ebitda.toFixed(2),
    financialRevenues: dre.financialRevenues.toFixed(2),
    financialExpenses: dre.financialExpenses.toFixed(2),
    financialResult: dre.financialResult.toFixed(2),
    lair: dre.lair.toFixed(2),
    taxes: dre.taxes.toFixed(2),
    netProfit: dre.netProfit.toFixed(2),
    netProfitPercentage: dre.netProfitPercentage.toFixed(2),
    operatingBreakEven: dre.operatingBreakEven.toFixed(2),
    financialBreakEven: dre.financialBreakEven.toFixed(2),
    safetyMargin: dre.safetyMargin.toFixed(2),
    taxRegime: dre.taxRegime || 'Simples Nacional',
    missingFields: dre.missingFields || [],
    taxNote: dre.taxNote,
  };
}

export function serializeIndicators(ind: FinancialIndicators) {
  const fmt = (d: Decimal | null, dp = 2) => (d === null ? null : d.toFixed(dp));
  return {
    grossMargin: fmt(ind.grossMargin),
    contributionMarginRatio: ind.contributionMarginRatio.toFixed(2),
    operatingMargin: ind.operatingMargin.toFixed(2),
    ebitdaMargin: ind.ebitdaMargin.toFixed(2),
    netMargin: ind.netMargin.toFixed(2),
    currentLiquidity: fmt(ind.currentLiquidity),
    quickLiquidity: fmt(ind.quickLiquidity),
    cashRatio: fmt(ind.cashRatio),
    debtToAssets: fmt(ind.debtToAssets),
    debtToEquity: fmt(ind.debtToEquity),
    interestCoverage: fmt(ind.interestCoverage),
    roe: fmt(ind.roe),
    roa: fmt(ind.roa),
    inventoryTurnoverDays: fmt(ind.inventoryTurnoverDays, 1),
    receivablesDays: fmt(ind.receivablesDays, 1),
    payablesDays: fmt(ind.payablesDays, 1),
    cashConversionCycle: fmt(ind.cashConversionCycle, 1),
    interpretations: ind.interpretations,
    missingInformation: ind.missingInformation,
  };
}

export function compareFinancialRecords(
  labelA: string,
  dreA: CalculatedDRE,
  labelB: string,
  dreB: CalculatedDRE
) {
  const delta = (a: Decimal, b: Decimal) => {
    const diff = b.minus(a);
    const pct = a.isZero() ? null : diff.dividedBy(a.abs()).times(100).toFixed(2);
    return {
      previous: a.toFixed(2),
      current: b.toFixed(2),
      absoluteDiff: diff.toFixed(2),
      percentChange: pct,
    };
  };

  return {
    baseLabel: labelA,
    targetLabel: labelB,
    metrics: {
      grossRevenue: delta(dreA.grossRevenue, dreB.grossRevenue),
      netRevenue: delta(dreA.netRevenue, dreB.netRevenue),
      cmv: delta(dreA.cmv, dreB.cmv),
      contributionMargin: delta(dreA.contributionMargin, dreB.contributionMargin),
      contributionMarginPercentage: delta(dreA.contributionMarginPercentage, dreB.contributionMarginPercentage),
      fixedExpenses: delta(dreA.fixedExpenses, dreB.fixedExpenses),
      operatingResult: delta(dreA.operatingResult, dreB.operatingResult),
      ebitda: delta(dreA.ebitda, dreB.ebitda),
      financialResult: delta(dreA.financialResult, dreB.financialResult),
      netProfit: delta(dreA.netProfit, dreB.netProfit),
      netProfitPercentage: delta(dreA.netProfitPercentage, dreB.netProfitPercentage),
      operatingBreakEven: delta(dreA.operatingBreakEven, dreB.operatingBreakEven),
    },
  };
}

export const SUPPORTED_EXPLAIN_METRICS = [
  'contributionMargin',
  'operatingResult',
  'ebit',
  'ebitda',
  'netProfit',
  'grossMargin',
  'operatingBreakEven',
  'financialBreakEven',
  'currentLiquidity',
  'cashConversionCycle',
] as const;

export function explainCalculation(metric: string, dre: CalculatedDRE, indicators: FinancialIndicators, input: RawFinancialInput) {
  const key = (metric || '').toLowerCase().trim();
  const explanations: Record<string, any> = {
    contributionmargin: {
      metric: 'Margem de Contribuição',
      formula: 'Receita Líquida - CMV/CPV - Despesas Variáveis de Venda',
      inputs: {
        netRevenue: dre.netRevenue.toFixed(2),
        cmv: dre.cmv.toFixed(2),
        variableExpenses: dre.variableExpenses.toFixed(2),
      },
      result: dre.contributionMargin.toFixed(2),
      percentageOfNetRevenue: `${dre.contributionMarginPercentage.toFixed(2)}%`,
      rounding: 'Exibição arredondada para 2 casas decimais; cálculo interno em precisão arbitrária via Decimal.js.',
      limitations: 'Depende da correta separação entre despesas variáveis e custos fixos.',
    },
    operatingresult: {
      metric: 'Resultado Operacional Gerencial de Caixa',
      formula: 'Margem de Contribuição - Despesas Fixas Operacionais de Caixa',
      inputs: {
        contributionMargin: dre.contributionMargin.toFixed(2),
        fixedExpenses: dre.fixedExpenses.toFixed(2),
      },
      result: dre.operatingResult.toFixed(2),
      percentageOfNetRevenue: `${dre.operatingResultPercentage.toFixed(2)}%`,
      rounding: '2 casas decimais na exibição.',
      limitations: 'Difere do EBIT por não descontar Depreciação e Amortização (D&A) e difere do conceito contábil de EBITDA caso existam provisões não-caixa.',
    },
    ebit: {
      metric: 'EBIT (Lucro Antes dos Juros e Tributos sobre o Resultado)',
      formula: 'Resultado Operacional Gerencial de Caixa - Depreciação e Amortização',
      inputs: {
        operatingResult: dre.operatingResult.toFixed(2),
        depreciation: dre.depreciation.toFixed(2),
      },
      result: dre.ebit.toFixed(2),
      rounding: '2 casas decimais na exibição.',
      limitations: 'Depende do registro contábil regular de Depreciação e Amortização.',
    },
    ebitda: {
      metric: 'EBITDA',
      formula: 'EBIT + Depreciação e Amortização',
      inputs: {
        operatingResult: dre.operatingResult.toFixed(2),
        depreciation: dre.depreciation.toFixed(2),
        ebit: dre.ebit.toFixed(2),
      },
      result: dre.ebitda.toFixed(2),
      percentageOfNetRevenue: `${indicators.ebitdaMargin.toFixed(2)}%`,
      rounding: '2 casas decimais na exibição.',
      limitations: 'Não equivale automaticamente a fluxo de caixa livre pois não considera variação de capital de giro, serviço da dívida ou CAPEX.',
    },
    netprofit: {
      metric: 'Lucro Líquido Gerencial',
      formula: 'LAIR (EBIT + Resultado Financeiro) - Impostos sobre o Resultado (IRPJ/CSLL)',
      inputs: {
        ebit: dre.ebit.toFixed(2),
        financialResult: dre.financialResult.toFixed(2),
        lair: dre.lair.toFixed(2),
        taxes: dre.taxes.toFixed(2),
        taxRegime: dre.taxRegime || input.taxRegime || 'Simples Nacional',
      },
      result: dre.netProfit.toFixed(2),
      percentageOfNetRevenue: `${dre.netProfitPercentage.toFixed(2)}%`,
      rounding: '2 casas decimais na exibição.',
      limitations: dre.taxNote || 'Depende da correta classificação tributária conforme o regime da empresa.',
    },
    grossmargin: {
      metric: 'Margem Bruta',
      formula: '((Receita Líquida - CMV/CPV) / Receita Líquida) × 100',
      inputs: {
        netRevenue: dre.netRevenue.toFixed(2),
        cmv: dre.cmv.toFixed(2),
      },
      result: indicators.grossMargin ? `${indicators.grossMargin.toFixed(2)}%` : 'Não calculável (Receita Líquida <= 0)',
      rounding: '2 casas decimais.',
      limitations: 'Considera apenas custos diretos de mercadorias/produtos/serviços (CMV/CPV), antes de comissões e taxas variáveis.',
    },
    operatingbreakeven: {
      metric: 'Ponto de Equilíbrio Operacional',
      formula: 'Despesas Fixas Operacionais / (Margem de Contribuição / Receita Líquida)',
      inputs: {
        fixedExpenses: dre.fixedExpenses.toFixed(2),
        contributionMarginRatio: `${indicators.contributionMarginRatio.toFixed(2)}%`,
      },
      result: dre.operatingBreakEven.toFixed(2),
      rounding: '2 casas decimais.',
      limitations: 'Assume mix de produtos constante e linearidade dos custos variáveis.',
    },
    financialbreakeven: {
      metric: 'Ponto de Equilíbrio Financeiro',
      formula: '(Despesas Fixas + Despesas Financeiras Líquidas) / Índice de Margem de Contribuição',
      inputs: {
        fixedExpenses: dre.fixedExpenses.toFixed(2),
        financialExpenses: dre.financialExpenses.toFixed(2),
        financialRevenues: dre.financialRevenues.toFixed(2),
        contributionMarginRatio: `${indicators.contributionMarginRatio.toFixed(2)}%`,
      },
      result: dre.financialBreakEven.toFixed(2),
      rounding: '2 casas decimais.',
      limitations: 'Considera encargos financeiros do período; amortizações de principal não transitam pela DRE.',
    },
    currentliquidity: {
      metric: 'Liquidez Corrente',
      formula: 'Ativo Circulante / Passivo Circulante',
      inputs: {
        currentAssets: parseOptionalDecimal(input.currentAssets)?.toFixed(2) ?? 'AUSENTE',
        currentLiabilities: parseOptionalDecimal(input.currentLiabilities)?.toFixed(2) ?? 'AUSENTE',
      },
      result: indicators.currentLiquidity ? `${indicators.currentLiquidity.toFixed(2)}x` : 'Não calculável (dados ausentes)',
      rounding: '2 casas decimais.',
      limitations: 'Não distingue a velocidade de realização dos estoques (para isso, consulte a Liquidez Seca).',
    },
    cashconversioncycle: {
      metric: 'Ciclo Financeiro (Ciclo de Caixa)',
      formula: 'PME (Dias de Estoque) + PMR (Dias de Recebimento) - PMP (Dias de Pagamento)',
      inputs: {
        inventory: parseOptionalDecimal(input.inventory)?.toFixed(2) ?? 'AUSENTE',
        accountsReceivable: parseOptionalDecimal(input.accountsReceivable)?.toFixed(2) ?? 'AUSENTE',
        accountsPayable: parseOptionalDecimal(input.accountsPayable)?.toFixed(2) ?? 'AUSENTE',
        pme: indicators.inventoryTurnoverDays?.toFixed(1) ?? 'AUSENTE',
        pmr: indicators.receivablesDays?.toFixed(1) ?? 'AUSENTE',
        pmp: indicators.payablesDays?.toFixed(1) ?? 'AUSENTE',
      },
      result: indicators.cashConversionCycle ? `${indicators.cashConversionCycle.toFixed(1)} dias` : 'Não calculável (dados ausentes)',
      rounding: '1 casa decimal em dias.',
      limitations: 'Baseado em saldos de fechamento do período em base de 30 dias.',
    },
  };

  const aliases: Record<string, string> = {
    'margem de contribuicao': 'contributionmargin',
    'margem_contribuicao': 'contributionmargin',
    'mc': 'contributionmargin',
    'resultado operacional': 'operatingresult',
    'resultado_operacional': 'operatingresult',
    'ebit': 'ebit',
    'ebitda': 'ebitda',
    'lucro liquido': 'netprofit',
    'lucro_liquido': 'netprofit',
    'margem bruta': 'grossmargin',
    'margem_bruta': 'grossmargin',
    'ponto de equilibrio': 'operatingbreakeven',
    'ponto de equilibrio operacional': 'operatingbreakeven',
    'pe operacional': 'operatingbreakeven',
    'ponto de equilibrio financeiro': 'financialbreakeven',
    'pe financeiro': 'financialbreakeven',
    'liquidez corrente': 'currentliquidity',
    'liquidez_corrente': 'currentliquidity',
    'ciclo financeiro': 'cashconversioncycle',
    'ciclo_financeiro': 'cashconversioncycle',
    'capital de giro': 'cashconversioncycle',
  };

  const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const resolvedKey = explanations[normalized] ? normalized : aliases[normalized];
  if (!resolvedKey || !explanations[resolvedKey]) {
    throw new Error(
      `Métrica desconhecida ou não suportada para explicação: "${metric}". Métricas válidas: ${SUPPORTED_EXPLAIN_METRICS.join(', ')}.`
    );
  }
  return explanations[resolvedKey];
}
