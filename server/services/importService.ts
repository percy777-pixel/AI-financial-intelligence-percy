import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  parseFinancialValueStrict,
  RawFinancialInput,
  validateFinancialInput,
  FinancialValidationResult,
} from './financialEngine.js';

export interface ParsedImportResult {
  headers: string[];
  rows: Record<string, any>[];
  fileName: string;
  sheetName?: string;
  error?: string;
}

export function parseCsvBuffer(buffer: Buffer): ParsedImportResult {
  const content = buffer.toString('utf-8');
  const parsed = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors && parsed.errors.length > 0) {
    return {
      headers: [],
      rows: [],
      fileName: 'csv-file',
      error: parsed.errors[0].message,
    };
  }

  const rows = parsed.data as Record<string, any>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    headers,
    rows,
    fileName: 'uploaded.csv',
  };
}

export function parseXlsxBuffer(buffer: Buffer, sheetIndex = 0): ParsedImportResult {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      return { headers: [], rows: [], fileName: 'xlsx-file', error: 'Excel file is empty' };
    }

    const targetSheetName = sheetNames[sheetIndex] || sheetNames[0];
    const worksheet = workbook.Sheets[targetSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

    if (jsonData.length === 0) {
      return { headers: [], rows: [], fileName: targetSheetName, error: 'Selected sheet is empty' };
    }

    const headers = (jsonData[0] || []).map(h => String(h || '').trim());
    const rawRows = jsonData.slice(1);

    const rows: Record<string, any>[] = [];
    for (const r of rawRows) {
      const rowObj: Record<string, any> = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        const val = r[idx];
        if (val !== undefined && val !== null && val !== '') {
          rowObj[h] = val;
          hasData = true;
        }
      });
      if (hasData) {
        rows.push(rowObj);
      }
    }

    return {
      headers,
      rows,
      fileName: targetSheetName,
    };
  } catch (err: any) {
    return {
      headers: [],
      rows: [],
      fileName: 'xlsx-file',
      error: err.message || 'Failed to parse XLSX file',
    };
  }
}

// Column synonyms map for intelligent mapping
export const SYNONYMS: Record<string, string[]> = {
  grossRevenue: ['receita bruta', 'faturamento bruto', 'receita total', 'vendas brutas', 'gross revenue', 'faturamento'],
  deductions: ['deduções', 'impostos sobre vendas', 'tributos sobre faturamento', 'deducoes', 'das', 'simples nacional', 'impostos faturamento'],
  cmv: ['cmv', 'cpv', 'custo das mercadorias', 'custo dos produtos vendidos', 'custo dos serviços', 'custo mercadoria'],
  variableExpenses: ['despesas variáveis', 'despesas variaveis', 'comissões', 'fretes variáveis', 'taxas cartão', 'variable expenses'],
  fixedExpenses: ['despesas fixas', 'custos fixos', 'despesas operacionais fixas', 'fixed expenses', 'despesas administrativas'],
  depreciation: ['depreciação', 'amortização', 'depreciacao', 'amortizacao', 'depreciation'],
  financialRevenues: ['receitas financeiras', 'juros ganhos', 'rendimentos financeiros'],
  financialExpenses: ['despesas financeiras', 'juros pagos', 'encargos financeiros'],
  taxes: ['impostos sobre o resultado', 'irpj', 'csll', 'imposto de renda'],
  cashAndEquivalents: ['caixa', 'disponibilidades', 'caixa e equivalentes', 'saldo bancário'],
  accountsReceivable: ['contas a receber', 'recebíveis', 'duplicatas a receber', 'clientes'],
  inventory: ['estoque', 'estoques', 'inventário', 'mercadorias em estoque'],
  accountsPayable: ['contas a pagar', 'fornecedores', 'duplicatas a pagar'],
  currentAssets: ['ativo circulante', 'current assets'],
  currentLiabilities: ['passivo circulante', 'current liabilities'],
  totalAssets: ['ativo total', 'total assets'],
  totalDebt: ['endividamento total', 'divida total', 'dívida total', 'total debt', 'passivo exigivel'],
  equity: ['patrimônio líquido', 'patrimonio liquido', 'equity'],
};

export function suggestColumnMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};

  for (const [field, synonyms] of Object.entries(SYNONYMS)) {
    for (const header of headers) {
      const cleanHeader = header.toLowerCase().trim();
      if (synonyms.some(syn => cleanHeader.includes(syn))) {
        mapping[field] = header;
        break;
      }
    }
  }

  return mapping;
}

export function extractAndValidateImportRow(
  row: Record<string, any>,
  columnMapping: Record<string, string>,
  taxRegime?: string
): {
  financialData: Partial<RawFinancialInput>;
  validation: FinancialValidationResult;
  unparseableFields: Array<{ field: string; column: string; rawValue: any; reason?: string }>;
} {
  const financialData: Record<string, any> = {};
  if (taxRegime) financialData.taxRegime = taxRegime;

  const unparseableFields: Array<{ field: string; column: string; rawValue: any; reason?: string }> = [];

  for (const [field, colHeader] of Object.entries(columnMapping)) {
    if (!colHeader || row[colHeader] === undefined || row[colHeader] === null) {
      continue;
    }
    const strictResult = parseFinancialValueStrict(row[colHeader]);
    if (strictResult.status === 'EMPTY') {
      continue;
    }
    if (strictResult.status === 'VALID' && strictResult.normalizedString !== null) {
      // Preserve exact string representation for Decimal.js precision
      financialData[field] = strictResult.normalizedString;
    } else {
      unparseableFields.push({
        field,
        column: colHeader,
        rawValue: row[colHeader],
        reason: strictResult.reason,
      });
    }
  }

  const validation = validateFinancialInput(financialData);
  if (unparseableFields.length > 0) {
    for (const bad of unparseableFields) {
      validation.errors.push(
        `Valor inválido ou ambíguo na coluna "${bad.column}" (${bad.field}): "${bad.rawValue}" — ${bad.reason || 'Não pôde ser interpretado com segurança.'}`
      );
    }
    validation.valid = false;
  }

  return {
    financialData,
    validation,
    unparseableFields,
  };
}
