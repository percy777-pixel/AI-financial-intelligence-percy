import Decimal from 'decimal.js';

export interface StrictParseResult {
  status: 'VALID' | 'EMPTY' | 'INVALID' | 'AMBIGUOUS';
  decimal: Decimal | null;
  normalizedString: string | null;
  reason?: string;
}

/**
 * Strictly parses financial values in Brazilian (pt-BR) and US/standard formats
 * without silently multiplying, dividing, or inventing numbers.
 *
 * Supported formats:
 * - "1.250,50" -> 1250.50
 * - "1250,50" -> 1250.50
 * - "1250.50" -> 1250.50
 * - "1250" -> 1250
 * - "R$ 1.250,50" -> 1250.50
 * - Negative variants: "-1.250,50", "R$ -1.250,50", "-R$ 1.250,50", "-1250.50"
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

  // Handle cases where sign was before R$ and another sign after, e.g. "--100"
  if (/^[+-]{2,}/.test(cleaned)) {
    return {
      status: 'INVALID',
      decimal: null,
      normalizedString: null,
      reason: `Sinal duplicado ou inválido em "${raw}".`,
    };
  }

  // Only digits, dots, commas, and optional leading sign are allowed
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
      // pt-BR format: dots must be valid thousands separators (groups of 3 digits) and single comma as decimal
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
      // en-US format: commas must be valid thousands separators (groups of 3 digits) and single dot as decimal
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
    // Check for ambiguous single dot with 3 trailing digits like "1.250" (when integer part is non-zero and 1-3 digits)
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
 * Extracts and validates a row of financial values on the frontend using the exact
 * same rules as the backend parser. Never silently drops invalid or ambiguous fields.
 */
export function parseFrontendImportRow(
  row: Record<string, any>,
  columnMapping: Record<string, string>
): {
  valid: boolean;
  financialData: Record<string, string>;
  invalidFields: Array<{ field: string; column: string; rawValue: any; reason: string }>;
  errors: string[];
} {
  const financialData: Record<string, string> = {};
  const invalidFields: Array<{ field: string; column: string; rawValue: any; reason: string }> = [];

  for (const [field, colHeader] of Object.entries(columnMapping)) {
    if (!colHeader) continue;
    const rawVal = row[colHeader];
    const res = parseFinancialValueStrict(rawVal);
    if (res.status === 'EMPTY') {
      continue;
    }
    if (res.status === 'VALID' && res.normalizedString !== null) {
      financialData[field] = res.normalizedString;
    } else {
      invalidFields.push({
        field,
        column: colHeader,
        rawValue: rawVal,
        reason: res.reason || `Valor inválido ou ambíguo: "${rawVal}"`,
      });
    }
  }

  return {
    valid: invalidFields.length === 0,
    financialData,
    invalidFields,
    errors: invalidFields.map(f => `Campo "${f.field}" (coluna "${f.column}"): ${f.reason}`),
  };
}
