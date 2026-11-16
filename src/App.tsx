import React, { useState, useEffect } from 'react';
import {
  Building2,
  Cpu,
  TrendingUp,
  FileSpreadsheet,
  BrainCircuit,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Upload,
  LayoutDashboard,
  History,
  DollarSign,
  PieChart,
  BarChart3,
  Bot,
  Workflow,
  ShieldCheck,
  HelpCircle,
  Landmark,
  Lock,
  LogOut,
  Newspaper,
} from 'lucide-react';
import { AgentIntelligenceCenter } from './components/AgentIntelligenceCenter';
import { EnhancedSimulator } from './components/EnhancedSimulator';
import { AutomationReportsView } from './components/AutomationReportsView';
import { MemoryGovernanceView } from './components/MemoryGovernanceView';
import { TextileSectorNewsView } from './components/TextileSectorNewsView';
import { parseFrontendImportRow } from './utils/financialParser';
import {
  apiFetch,
  clearClientAuthTokens,
  setActiveCsrfToken,
  setActiveSessionToken,
  setOnUnauthorizedCallback,
} from './utils/apiFetch';

const ALL_MAPPABLE_FINANCIAL_FIELDS: Array<{ key: string; label: string; required?: boolean }> = [
  { key: 'grossRevenue', label: 'Receita Bruta *', required: true },
  { key: 'deductions', label: 'Deduções / Impostos s/ Vendas' },
  { key: 'cmv', label: 'CMV / CPV' },
  { key: 'variableExpenses', label: 'Despesas Variáveis' },
  { key: 'fixedExpenses', label: 'Despesas Fixas Operacionais' },
  { key: 'depreciation', label: 'Depreciação e Amortização' },
  { key: 'financialRevenues', label: 'Receitas Financeiras' },
  { key: 'financialExpenses', label: 'Despesas Financeiras' },
  { key: 'taxes', label: 'IRPJ / CSLL sobre Resultado' },
  { key: 'cashAndEquivalents', label: 'Caixa e Equivalentes' },
  { key: 'accountsReceivable', label: 'Contas a Receber' },
  { key: 'inventory', label: 'Estoques' },
  { key: 'accountsPayable', label: 'Fornecedores / Contas a Pagar' },
  { key: 'currentAssets', label: 'Ativo Circulante' },
  { key: 'currentLiabilities', label: 'Passivo Circulante' },
  { key: 'totalAssets', label: 'Ativo Total' },
  { key: 'totalDebt', label: 'Dívida Total' },
  { key: 'equity', label: 'Patrimônio Líquido' },
];

type TabId =
  | 'overview'
  | 'agent'
  | 'companies'
  | 'import'
  | 'engine'
  | 'macro'
  | 'textile_news'
  | 'ai'
  | 'simulator'
  | 'automation'
  | 'history'
  | 'memory';

interface Company {
  id: string;
  name: string;
  cnpj?: string;
  industry?: string;
  taxRegime?: string;
  createdAt: string;
  periods?: any[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [health, setHealth] = useState<any>(null);
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [authStatus, setAuthStatus] = useState<{
    authEnforced: boolean;
    authenticated: boolean;
    csrfToken: string | null;
    policyNote?: string;
  } | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [companyContext, setCompanyContext] = useState<any>(null);

  // New Company Form
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyCnpj, setNewCompanyCnpj] = useState('');
  const [newCompanyIndustry, setNewCompanyIndustry] = useState('Varejo de Vestuário');
  const [newCompanyRegime, setNewCompanyRegime] = useState('Simples Nacional');
  const [creatingCompany, setCreatingCompany] = useState(false);

  // New Debt Facility Form
  const [debtName, setDebtName] = useState('');
  const [debtLender, setDebtLender] = useState('');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtIndexer, setDebtIndexer] = useState<'SELIC' | 'CDI' | 'IPCA' | 'PRE_FIXADO'>('CDI');
  const [debtSpread, setDebtSpread] = useState('4.5');

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importYear, setImportYear] = useState<number>(2026);
  const [importMonth, setImportMonth] = useState<number>(11);
  const [importRowIndex, setImportRowIndex] = useState<number>(0);
  const [rejectDuplicateImport, setRejectDuplicateImport] = useState<boolean>(false);
  const [importing, setImporting] = useState(false);

  // Macro State
  const [macroIndicators, setMacroIndicators] = useState<any[]>([]);
  const [selectedMacroCode, setSelectedMacroCode] = useState<string>('SELIC');
  const [macroHistory, setMacroHistory] = useState<any[]>([]);
  const [syncingMacro, setSyncingMacro] = useState(false);

  // AI Diagnostic State
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null);
  const [generatingDiagnostic, setGeneratingDiagnostic] = useState(false);

  // Formula Explainer State
  const [explainedMetric, setExplainedMetric] = useState<any>(null);

  // History State
  const [periodsHistory, setPeriodsHistory] = useState<any[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setOnUnauthorizedCallback(() => {
      clearClientAuthTokens();
      setAuthStatus(prev => (prev ? { ...prev, authenticated: false, csrfToken: null } : null));
    });
    return () => {
      setOnUnauthorizedCallback(null);
    };
  }, []);

  const fetchSystemStatus = async () => {
    setLoadingStatus(true);
    try {
      const [healthRes, dbRes, authRes] = await Promise.all([
        apiFetch('/api/health').then(res => res.json()).catch(() => null),
        apiFetch('/api/database/status').then(res => res.json()).catch(() => null),
        apiFetch('/api/auth/status').then(res => res.json()).catch(() => null),
      ]);

      setHealth(healthRes);
      setDbStatus(dbRes);

      if (authRes) {
        if (authRes.authenticated && authRes.csrfToken) {
          setActiveCsrfToken(authRes.csrfToken);
        } else if (authRes.authEnforced && !authRes.authenticated) {
          clearClientAuthTokens();
        }
        setAuthStatus({
          authEnforced: Boolean(authRes.authEnforced),
          authenticated: Boolean(authRes.authenticated),
          csrfToken: authRes.csrfToken || null,
          policyNote: authRes.policyNote,
        });
      }

      if (!authRes || !authRes.authEnforced || authRes.authenticated) {
        const [compRes, macroRes] = await Promise.all([
          apiFetch('/api/companies').then(res => (res.ok ? res.json() : [])).catch(() => []),
          apiFetch('/api/macro/indicators').then(res => (res.ok ? res.json() : [])).catch(() => []),
        ]);

        if (Array.isArray(compRes) && compRes.length > 0) {
          setCompanies(compRes);
          if (!selectedCompanyId) {
            setSelectedCompanyId(compRes[0].id);
          }
        }
        if (Array.isArray(macroRes)) {
          setMacroIndicators(macroRes);
        }
      }
    } catch (err: any) {
      setErrorMsg('Erro ao carregar dados do sistema: ' + err.message);
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginPassword) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Credenciais administrativas inválidas.');
      }
      if (data.sessionToken) {
        setActiveSessionToken(data.sessionToken);
      }
      setActiveCsrfToken(data.csrfToken || null);
      setAuthStatus(prev => ({
        authEnforced: true,
        authenticated: true,
        csrfToken: data.csrfToken || null,
        policyNote: prev?.policyNote,
      }));
      setLoginPassword('');
      await fetchSystemStatus();
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    } finally {
      clearClientAuthTokens();
      setAuthStatus(prev => (prev ? { ...prev, authenticated: false, csrfToken: null } : null));
      setCompanies([]);
      setCompanyContext(null);
    }
  };

  const fetchCompanyDetails = async (compId: string) => {
    if (!compId) return;
    if (authStatus?.authEnforced && !authStatus?.authenticated) return;
    try {
      const [ctxRes, perRes] = await Promise.all([
        apiFetch(`/api/companies/${compId}/context`).then(r => (r.ok ? r.json() : null)),
        apiFetch(`/api/companies/${compId}/periods`).then(r => (r.ok ? r.json() : [])),
      ]);
      if (ctxRes) setCompanyContext(ctxRes);
      if (Array.isArray(perRes)) {
        setPeriodsHistory(perRes);
      }
    } catch {
      // Ignore silent reload error
    }
  };

  useEffect(() => {
    fetchSystemStatus();
  }, []);

  useEffect(() => {
    if (selectedCompanyId && (!authStatus?.authEnforced || authStatus?.authenticated)) {
      setDiagnosticResult(null);
      setExplainedMetric(null);
      fetchCompanyDetails(selectedCompanyId);
    }
  }, [selectedCompanyId, authStatus?.authenticated]);

  useEffect(() => {
    if (authStatus?.authEnforced && !authStatus?.authenticated) return;
    apiFetch(`/api/macro/history?code=${encodeURIComponent(selectedMacroCode)}&limit=6`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (Array.isArray(data?.history)) setMacroHistory(data.history);
      })
      .catch(() => {});
  }, [selectedMacroCode, macroIndicators, authStatus?.authenticated]);

  const handleSyncMacro = async () => {
    setSyncingMacro(true);
    try {
      const res = await apiFetch('/api/macro/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao sincronizar dados');
      const macroRes = await apiFetch('/api/macro/indicators').then(res => res.json());
      setMacroIndicators(macroRes);
      setSuccessMsg(
        `Sincronização concluída (${data.syncSource}): ${data.count} observações (${data.liveSeriesCount} ao vivo, ${data.fallbackSeriesCount} referência local).`
      );
      if (selectedCompanyId) fetchCompanyDetails(selectedCompanyId);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSyncingMacro(false);
    }
  };

  const handleGenerateDiagnostic = async () => {
    if (!selectedCompanyId) {
      setErrorMsg('Selecione uma empresa.');
      return;
    }
    setGeneratingDiagnostic(true);
    setErrorMsg(null);

    try {
      const res = await apiFetch(`/api/companies/${selectedCompanyId}/diagnostic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dre: companyContext?.dre,
          indicators: companyContext?.indicators,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar diagnóstico');

      setDiagnosticResult(data);
      setSuccessMsg(`Diagnóstico gerado via ${data.provider === 'GEMINI' ? 'Google Gemini AI' : 'Fallback Determinístico'}!`);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setGeneratingDiagnostic(false);
    }
  };

  const handleExplainMetric = async (metric: string) => {
    if (!selectedCompanyId) return;
    try {
      const res = await apiFetch(`/api/companies/${selectedCompanyId}/explain?metric=${encodeURIComponent(metric)}`);
      const data = await res.json();
      if (res.ok) setExplainedMetric(data);
    } catch {
      // Ignore
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    setCreatingCompany(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await apiFetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCompanyName,
          cnpj: newCompanyCnpj || undefined,
          industry: newCompanyIndustry,
          taxRegime: newCompanyRegime,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar empresa');

      setSuccessMsg(`Empresa "${data.name}" cadastrada com sucesso!`);
      setNewCompanyName('');
      setNewCompanyCnpj('');
      await fetchSystemStatus();
      setSelectedCompanyId(data.id);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setCreatingCompany(false);
    }
  };

  const handleAddDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCompanyId || !debtName || !debtLender || !debtBalance) return;
    try {
      const res = await apiFetch(`/api/companies/${selectedCompanyId}/debts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: debtName,
          lender: debtLender,
          outstandingBalance: Number(debtBalance),
          indexer: debtIndexer,
          spreadAnnualPct: Number(debtSpread),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao adicionar contrato');
      setDebtName('');
      setDebtLender('');
      setDebtBalance('');
      setSuccessMsg('Contrato de dívida registrado na carteira.');
      await fetchCompanyDetails(selectedCompanyId);
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('O arquivo excede o limite de 5 MB.');
      return;
    }

    setImportFile(file);
    setErrorMsg(null);
    setSuccessMsg(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/import/preview', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao processar preview');

      setPreviewData(data);
      setImportRowIndex(0);
      setColumnMapping(data.suggestedMapping || {});
      setSuccessMsg(
        `Planilha carregada (${data.totalRows || data.rows?.length || 1} linha(s)). Verifique o mapeamento das colunas.`
      );
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const handleProcessImport = async () => {
    if (!selectedCompanyId) {
      setErrorMsg('Selecione uma empresa antes de importar.');
      return;
    }
    if (!previewData || previewData.rows.length === 0) {
      setErrorMsg('Nenhum dado disponível.');
      return;
    }

    setImporting(true);
    setErrorMsg(null);

    try {
      const targetRow = previewData.rows[importRowIndex] || previewData.rows[0];
      const parsedRow = parseFrontendImportRow(targetRow, columnMapping);

      if (parsedRow.errors.length > 0) {
        throw new Error(parsedRow.errors.join(' | '));
      }

      const res = await apiFetch(`/api/companies/${selectedCompanyId}/periods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': selectedCompanyId,
        },
        body: JSON.stringify({
          year: importYear,
          month: importMonth,
          periodType: 'MONTHLY',
          financialData: parsedRow.financialData,
          changeReason: `Importação via ${importFile?.name || 'arquivo'} (linha ${importRowIndex + 1})`,
          rejectDuplicate: rejectDuplicateImport,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const detail = data.validation?.errors?.join(' | ');
        throw new Error(detail || data.error || 'Erro ao processar período');
      }

      setSuccessMsg(
        data.duplicateDetected
          ? `Importação idêntica à versão ativa v${data.versionNumber} detectada (sem duplicação).`
          : `Dados validados com precisão Decimal.js e DRE calculada com sucesso (v${data.versionNumber}).`
      );
      await fetchCompanyDetails(selectedCompanyId);
      setActiveTab('engine');
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setImporting(false);
    }
  };

  const currentCompany = companies.find(c => c.id === selectedCompanyId) || companies[0];
  const activeDre = companyContext?.dre || {
    grossRevenue: '0',
    deductions: '0',
    netRevenue: '0',
    cmv: '0',
    variableExpenses: '0',
    contributionMargin: '0',
    contributionMarginPercentage: '0',
    fixedExpenses: '0',
    operatingResult: '0',
    operatingResultPercentage: '0',
    depreciation: '0',
    ebit: '0',
    ebitda: '0',
    financialResult: '0',
    lair: '0',
    taxes: '0',
    netProfit: '0',
    netProfitPercentage: '0',
    operatingBreakEven: '0',
    financialBreakEven: '0',
    safetyMargin: '0',
  };
  const activeIndicators = companyContext?.indicators || {};
  const activeDebts = companyContext?.debts || [];
  const activePeriodLabel = companyContext?.activePeriod
    ? `${companyContext.activePeriod.month ? `${String(companyContext.activePeriod.month).padStart(2, '0')}/` : ''}${companyContext.activePeriod.year} (v${companyContext.activePeriod.versionNumber})`
    : 'Sem período';

  const navItems: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'overview', label: '1. Visão Executiva', icon: LayoutDashboard },
    { id: 'agent', label: '2. Agente IA (Centro)', icon: Bot },
    { id: 'companies', label: '3. Empresas & Dívidas', icon: Building2 },
    { id: 'import', label: '4. Importação Manual', icon: Upload },
    { id: 'engine', label: '5. DRE & Indicadores', icon: FileSpreadsheet },
    { id: 'macro', label: '6. Inteligência Macro', icon: TrendingUp },
    { id: 'textile_news', label: '7. Notícias Têxtil & Moda', icon: Newspaper },
    { id: 'ai', label: '8. Diagnóstico Executivo', icon: BrainCircuit },
    { id: 'simulator', label: '9. Simulador Avançado', icon: Sliders },
    { id: 'automation', label: '10. Automação & Relatórios', icon: Workflow },
    { id: 'history', label: '11. Histórico & Versões', icon: History },
    { id: 'memory', label: '12. Memória & Governança', icon: ShieldCheck },
  ];

  if (authStatus?.authEnforced && !authStatus?.authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 font-sans">
        <div className="w-full max-w-md p-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl space-y-6">
          <div className="flex items-center space-x-3.5">
            <div className="p-3 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl shadow-lg shadow-indigo-500/25 ring-1 ring-white/10">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">AI Financial Intelligence</h1>
              <p className="text-xs text-slate-400">Autenticação Administrativa de Demonstração Segura</p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-indigo-300">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Controle de Acesso de Usuário Único</span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Sessão protegida via cookie <code className="text-slate-200">HttpOnly</code> (<code className="text-slate-200">SameSite=Strict</code>), token anti-CSRF (<code className="text-slate-200">X-CSRF-Token</code>) e bloqueio contra força bruta.
            </p>
            <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                DB: {dbStatus?.isConnected ? 'PostgreSQL Neon' : 'Verificando...'}
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-300">
                IA: {health?.aiConfigured ? 'Gemini Configurado' : 'Fallback Determinístico'}
              </span>
            </div>
          </div>

          {loginError && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha Administrativa (<code className="text-indigo-300">APP_ADMIN_PASSWORD</code>)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                <input
                  type="password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Digite a senha administrativa..."
                  required
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition"
            >
              {loggingIn ? 'Validando Credenciais...' : 'Entrar no Sistema'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur px-6 py-4 flex justify-between items-center z-40 sticky top-0 gap-4">
        <div className="flex items-center space-x-3.5 min-w-0">
          <div className="p-2.5 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl shadow-lg shadow-indigo-500/25 ring-1 ring-white/10 shrink-0">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-bold text-base text-white tracking-tight whitespace-nowrap">
                AI Financial Intelligence
              </span>
              {currentCompany?.name?.includes('DEMONSTRAÇÃO') && (
                <span className="text-[11px] text-amber-300 font-medium whitespace-nowrap">
                  · Dados Fictícios de Demonstração
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              Plataforma de Inteligência Financeira, Agentes com Ferramentas e Automação Empresarial
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3 text-xs shrink-0">
          {companies.length > 0 && (
            <select
              value={selectedCompanyId}
              onChange={e => setSelectedCompanyId(e.target.value)}
              aria-label="Selecionar empresa ativa"
              className="hidden md:block max-w-[260px] px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-200 font-medium focus:outline-none focus:border-indigo-500"
            >
              {companies.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <div
            className={`hidden xl:flex px-2.5 py-1.5 rounded-xl border items-center gap-1.5 whitespace-nowrap ${
              dbStatus?.isConnected
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            }`}
            title={
              dbStatus?.isConnected
                ? 'Persistência ativa no PostgreSQL'
                : 'Modo de demonstração em memória (não persistido em banco)'
            }
          >
            <span className="font-medium">
              DB: {dbStatus?.isConnected ? 'PostgreSQL' : 'Memória Demo'}
            </span>
          </div>

          <div
            className="hidden lg:flex px-2.5 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-300 items-center gap-1.5 whitespace-nowrap"
            title="Origem atual das séries macroeconômicas (API BCB/IBGE vs Cache Local de Referência)"
          >
            <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-medium">
              Macro: {macroIndicators.some(m => m.syncSource === 'LIVE_API') ? 'API BCB Ao Vivo' : 'Cache Ref. Local'}
            </span>
          </div>

          <div className="hidden sm:flex px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 items-center gap-1.5 whitespace-nowrap">
            <Cpu className="w-3.5 h-3.5" />
            <span className="font-medium">
              {health?.aiConfigured ? 'Gemini Ativo' : 'Modo Fallback Local'}
            </span>
          </div>

          <button
            onClick={() => {
              fetchSystemStatus();
              if (selectedCompanyId) fetchCompanyDetails(selectedCompanyId);
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            title="Atualizar dados do sistema"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          </button>

          {authStatus?.authEnforced && authStatus?.authenticated && (
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 flex items-center gap-1.5 transition"
              title="Encerrar sessão administrativa"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile Navigation Selector */}
      <div className="lg:hidden px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
        <select
          value={activeTab}
          onChange={e => setActiveTab(e.target.value as TabId)}
          className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white"
        >
          {navItems.map(item => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        {companies.length > 0 && (
          <select
            value={selectedCompanyId}
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="max-w-[160px] px-2.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 truncate"
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-68 bg-slate-900/60 border-r border-slate-800/80 hidden lg:flex flex-col p-4 space-y-1.5 backdrop-blur shrink-0">
          <div className="text-[11px] font-bold text-slate-400 uppercase px-3 py-2 tracking-wider">
            Navegação Executiva
          </div>
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-white/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}

          <div className="mt-auto pt-4 border-t border-slate-800/80 text-[11px] text-slate-400 px-3 space-y-1">
            <div className="font-semibold text-slate-300">Motor Determinístico</div>
            <div>Precisão Decimal.js · {dbStatus?.isConnected ? 'PostgreSQL' : 'Store Local'}</div>
          </div>
        </aside>

        {/* Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-10 bg-slate-950">
          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center justify-between text-sm max-w-7xl mx-auto">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-rose-300 font-bold ml-4">
                ✕
              </button>
            </div>
          )}

          {successMsg && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center justify-between text-sm max-w-7xl mx-auto">
              <div className="flex items-center space-x-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>{successMsg}</span>
              </div>
              <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-300 font-bold ml-4">
                ✕
              </button>
            </div>
          )}

          {/* TAB 1: VISÃO EXECUTIVA */}
          {activeTab === 'overview' && (
            <div className="space-y-8 max-w-7xl mx-auto">
              <div className="p-8 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 border border-slate-800 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                <div className="max-w-3xl">
                  <div className="text-xs text-indigo-300 font-medium mb-2">
                    {currentCompany?.name || 'Empresa'} · {currentCompany?.taxRegime || 'Regime'} · Período {activePeriodLabel}
                  </div>
                  <h2 className="text-3xl font-extrabold text-white tracking-tight mb-2">
                    Centro de Inteligência Empresarial
                  </h2>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Análise executiva fundamentada no motor financeiro determinístico Decimal.js, conectada a séries macroeconômicas oficiais e operada por agente autônomo com ferramentas auditáveis.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setActiveTab('textile_news')}
                    className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Newspaper className="w-4 h-4" />
                    <span>Radar Têxtil & Vestuário</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('agent')}
                    className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 flex items-center gap-2 transition whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Bot className="w-4 h-4" />
                    <span>Perguntar ao Agente IA</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('simulator')}
                    className="px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm border border-slate-700 transition flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sliders className="w-4 h-4" />
                    <span>Simular Cenários</span>
                  </button>
                </div>
              </div>

              {/* Executive Indicators Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {[
                  {
                    label: 'Receita Líquida',
                    value: `R$ ${Number(activeDre.netRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    note: companyContext?.periodComparison?.metrics?.netRevenue?.percentChange
                      ? `${companyContext.periodComparison.metrics.netRevenue.percentChange}% vs período anterior`
                      : 'Base auditada (Backend)',
                    icon: DollarSign,
                  },
                  {
                    label: 'Margem de Contribuição',
                    value: `R$ ${Number(activeDre.contributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    note: `${activeIndicators.contributionMarginRatio || activeDre.contributionMarginPercentage || '0'}% da receita líquida`,
                    icon: PieChart,
                  },
                  {
                    label: 'Resultado Operacional (Caixa)',
                    value: `R$ ${Number(activeDre.operatingResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    note: `Margem operacional de ${activeIndicators.operatingMargin || activeDre.operatingResultPercentage || '0'}%`,
                    icon: TrendingUp,
                  },
                  {
                    label: 'Lucro Líquido Gerencial',
                    value: `R$ ${Number(activeDre.netProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    note: `Margem líquida de ${activeIndicators.netMargin || activeDre.netProfitPercentage || '0'}%`,
                    icon: BarChart3,
                  },
                ].map((card, idx) => {
                  const Icon = card.icon;
                  return (
                    <div key={idx} className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{card.label}</span>
                        <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                          <Icon className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-white tracking-tight font-mono tabular-nums">{card.value}</div>
                      <span className="text-xs text-slate-400 mt-2 block">{card.note}</span>
                    </div>
                  );
                })}
              </div>

              {/* Financial Evolution & Managerial Attention */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg">
                  <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-indigo-400" />
                    <span>Estrutura de Margens ({activePeriodLabel})</span>
                  </h3>
                  <div className="space-y-4 text-sm">
                    {[
                      {
                        label: 'Receita Líquida / Receita Bruta',
                        percent:
                          Number(activeDre.grossRevenue) > 0
                            ? Math.min(100, (Number(activeDre.netRevenue) / Number(activeDre.grossRevenue)) * 100)
                            : 0,
                        amount: `R$ ${Number(activeDre.netRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                        color: 'bg-indigo-500',
                      },
                      {
                        label: 'Margem de Contribuição',
                        percent: Math.max(0, Math.min(100, Number(activeIndicators.contributionMarginRatio || 0))),
                        amount: `R$ ${Number(activeDre.contributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                        color: 'bg-blue-500',
                      },
                      {
                        label: 'Resultado Operacional de Caixa',
                        percent: Math.max(0, Math.min(100, Number(activeIndicators.operatingMargin || 0))),
                        amount: `R$ ${Number(activeDre.operatingResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                        color: 'bg-emerald-500',
                      },
                      {
                        label: 'Lucro Líquido Gerencial',
                        percent: Math.max(0, Math.min(100, Number(activeIndicators.netMargin || 0))),
                        amount: `R$ ${Number(activeDre.netProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                        color: 'bg-emerald-400',
                      },
                    ].map((item, i) => (
                      <div key={i} className="space-y-1.5">
                        <div className="flex justify-between text-xs font-medium text-slate-300">
                          <span>{item.label}</span>
                          <span className="font-mono tabular-nums">
                            {item.amount} ({item.percent.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                          <div className={`h-full ${item.color} rounded-full transition-all`} style={{ width: `${item.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800/80 shadow-lg space-y-4">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                    <span>Atenção Gerencial & Qualidade</span>
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <strong className="text-white block font-medium">Exposição a Juros (Selic/CDI)</strong>
                      <p className="text-slate-400">
                        Dívida pós-fixada: R${' '}
                        {Number(companyContext?.economicContext?.debtExposureSummary?.floatingRateDebt || 0).toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                        })}{' '}
                        ({companyContext?.economicContext?.debtExposureSummary?.floatingSharePct || '0'}% do total).
                      </p>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <strong className="text-white block font-medium">Ponto de Equilíbrio & Segurança</strong>
                      <p className="text-slate-400 font-mono tabular-nums">
                        PE Operacional: R$ {Number(activeDre.operatingBreakEven).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ·
                        Margem de Segurança: {activeDre.safetyMargin}%
                      </p>
                    </div>
                    {companyContext?.validation?.missingFields?.length > 0 && (
                      <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1">
                        <strong className="text-amber-300 block font-medium">
                          Completude dos Dados: {companyContext.validation.completenessPct}%
                        </strong>
                        <p className="text-amber-200/80">
                          {companyContext.validation.missingFields.length} campo(s) ausente(s) — ex.:{' '}
                          {companyContext.validation.missingFields[0].field}.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: AI AGENT CENTER */}
          {activeTab === 'agent' && (
            <AgentIntelligenceCenter
              companyId={selectedCompanyId}
              companyName={currentCompany?.name || 'Empresa'}
              taxRegime={currentCompany?.taxRegime}
              onSuccessMsg={setSuccessMsg}
              onErrorMsg={setErrorMsg}
            />
          )}

          {/* TAB 3: COMPANIES & DEBTS */}
          {activeTab === 'companies' && (
            <div className="space-y-8 max-w-6xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Plus className="w-5 h-5 text-indigo-400" />
                    <span>Cadastrar Empresa</span>
                  </h3>
                  <form onSubmit={handleCreateCompany} className="space-y-4 text-sm">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Nome da Empresa *</label>
                      <input
                        type="text"
                        value={newCompanyName}
                        onChange={e => setNewCompanyName(e.target.value)}
                        placeholder="Ex: Comercial Delta Vestuário Ltda"
                        required
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">CNPJ</label>
                      <input
                        type="text"
                        value={newCompanyCnpj}
                        onChange={e => setNewCompanyCnpj(e.target.value)}
                        placeholder="00.000.000/0001-00"
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Setor</label>
                      <input
                        type="text"
                        value={newCompanyIndustry}
                        onChange={e => setNewCompanyIndustry(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">Regime Tributário</label>
                      <select
                        value={newCompanyRegime}
                        onChange={e => setNewCompanyRegime(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                      >
                        <option value="Simples Nacional">Simples Nacional</option>
                        <option value="Lucro Presumido">Lucro Presumido</option>
                        <option value="Lucro Real">Lucro Real</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={creatingCompany}
                      className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-indigo-600/20"
                    >
                      {creatingCompany ? 'Salvando...' : 'Cadastrar Empresa'}
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                      <Building2 className="w-5 h-5 text-indigo-400" />
                      <span>Selecionar Empresa Ativa</span>
                    </h3>
                    <div className="space-y-3">
                      {companies.map(c => (
                        <div
                          key={c.id}
                          onClick={() => setSelectedCompanyId(c.id)}
                          className={`p-4 rounded-xl border transition cursor-pointer flex justify-between items-center ${
                            selectedCompanyId === c.id
                              ? 'bg-indigo-600/10 border-indigo-500 text-white shadow-md'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                          }`}
                        >
                          <div>
                            <div className="font-bold text-base">{c.name}</div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              CNPJ: {c.cnpj || '-'} · Setor: {c.industry || 'Geral'} · Regime: {c.taxRegime || 'Simples Nacional'}
                            </div>
                          </div>
                          {selectedCompanyId === c.id && (
                            <span className="text-indigo-300 text-xs font-semibold shrink-0 ml-3">Ativa</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Debt Facilities Portfolio */}
                  <div className="pt-6 border-t border-slate-800 space-y-4">
                    <h4 className="text-base font-bold text-white flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-indigo-400" />
                      <span>Carteira de Endividamento & Indexadores ({activeDebts.length})</span>
                    </h4>
                    <div className="space-y-2 text-xs">
                      {activeDebts.map((d: any) => (
                        <div key={d.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap justify-between items-center gap-2">
                          <div>
                            <div className="font-semibold text-white">{d.name}</div>
                            <div className="text-slate-400">
                              {d.lender} · Indexador: <span className="text-indigo-300 font-mono">{d.indexer}</span> + {d.spreadAnnualPct}% a.a.
                            </div>
                          </div>
                          <div className="text-right font-mono tabular-nums">
                            <div className="text-white font-semibold">
                              R$ {Number(d.outstandingBalance).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </div>
                            <div className="text-slate-500">Saldo devedor</div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleAddDebt} className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs pt-2">
                      <input
                        type="text"
                        placeholder="Linha (ex: Giro)"
                        value={debtName}
                        onChange={e => setDebtName(e.target.value)}
                        required
                        className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                      />
                      <input
                        type="text"
                        placeholder="Instituição"
                        value={debtLender}
                        onChange={e => setDebtLender(e.target.value)}
                        required
                        className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                      />
                      <input
                        type="number"
                        placeholder="Saldo (R$)"
                        value={debtBalance}
                        onChange={e => setDebtBalance(e.target.value)}
                        required
                        className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                      />
                      <select
                        value={debtIndexer}
                        onChange={e => setDebtIndexer(e.target.value as any)}
                        className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white"
                      >
                        <option value="CDI">CDI + spread</option>
                        <option value="SELIC">SELIC + spread</option>
                        <option value="IPCA">IPCA + spread</option>
                        <option value="PRE_FIXADO">Pré-fixado</option>
                      </select>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Spread %"
                          value={debtSpread}
                          onChange={e => setDebtSpread(e.target.value)}
                          className="w-20 px-2 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                        />
                        <button type="submit" className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                          + Add
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: IMPORT DATA */}
          {activeTab === 'import' && (
            <div className="space-y-8 max-w-5xl mx-auto">
              <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                <h2 className="text-2xl font-bold text-white mb-2">Importação de Dados Financeiros (CSV / XLSX)</h2>
                <p className="text-slate-400 text-sm mb-6">
                  Faça upload com reconhecimento automático por sinônimos e validação contábil estrita antes de salvar.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6 text-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Empresa</label>
                    <select
                      value={selectedCompanyId}
                      onChange={e => setSelectedCompanyId(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                    >
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Ano</label>
                    <input
                      type="number"
                      value={importYear}
                      onChange={e => setImportYear(Number(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Mês</label>
                    <select
                      value={importMonth}
                      onChange={e => setImportMonth(Number(e.target.value))}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          Mês {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-8 text-center bg-slate-950/60 hover:border-indigo-500/40 transition">
                  <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileChange} className="hidden" id="file-upload" />
                  <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                    <Upload className="w-10 h-10 text-indigo-400 mb-3" />
                    <span className="text-white font-medium text-sm">Selecionar arquivo CSV ou XLSX</span>
                    <span className="text-xs text-slate-500 mt-1">Até 5 MB.</span>
                  </label>
                </div>

                {previewData && (
                  <div className="mt-8 space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          Mapeamento Completo de Colunas ({ALL_MAPPABLE_FINANCIAL_FIELDS.length} campos financeiros)
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Formatos suportados com precisão Decimal: <code className="text-indigo-300">1.250,50</code>,{' '}
                          <code className="text-indigo-300">1250,50</code>, <code className="text-indigo-300">1250.50</code>,{' '}
                          <code className="text-indigo-300">1250</code>, <code className="text-indigo-300">R$ 1.250,50</code>. Valores ambíguos são bloqueados para correção.
                        </p>
                      </div>
                      {previewData.rows?.length > 1 && (
                        <div className="flex items-center gap-2 text-xs">
                          <label className="text-slate-400 font-medium whitespace-nowrap">Linha a importar:</label>
                          <select
                            value={importRowIndex}
                            onChange={e => setImportRowIndex(Number(e.target.value))}
                            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200 font-mono"
                          >
                            {previewData.rows.map((_: any, idx: number) => (
                              <option key={idx} value={idx}>
                                Linha {idx + 1} de {previewData.rows.length}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      {ALL_MAPPABLE_FINANCIAL_FIELDS.map(fieldDef => {
                        const selectedHeader = columnMapping[fieldDef.key] || '';
                        const activeRow = previewData.rows[importRowIndex] || previewData.rows[0] || {};
                        const rawPreviewVal = selectedHeader ? activeRow[selectedHeader] : undefined;
                        return (
                          <div key={fieldDef.key} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                            <div className="flex justify-between items-center">
                              <label className="block font-semibold text-indigo-300">{fieldDef.label}</label>
                              <span className="font-mono text-[10px] text-slate-500">{fieldDef.key}</span>
                            </div>
                            <select
                              value={selectedHeader}
                              onChange={e => setColumnMapping({ ...columnMapping, [fieldDef.key]: e.target.value })}
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                            >
                              <option value="">-- Não mapeado --</option>
                              {previewData.headers.map((h: string) => (
                                <option key={h} value={h}>
                                  {h}
                                </option>
                              ))}
                            </select>
                            {selectedHeader && (
                              <div className="text-[11px] text-slate-400 font-mono truncate">
                                Valor na linha: <span className="text-slate-200">{String(rawPreviewVal ?? '-')}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        id="reject-duplicate-import"
                        checked={rejectDuplicateImport}
                        onChange={e => setRejectDuplicateImport(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 accent-indigo-500"
                      />
                      <label htmlFor="reject-duplicate-import" className="cursor-pointer">
                        Bloquear importação se os dados financeiros forem idênticos à versão ativa deste período
                      </label>
                    </div>

                    <button
                      onClick={handleProcessImport}
                      disabled={importing}
                      className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/30"
                    >
                      {importing ? 'Validando & Processando...' : 'Validar, Calcular DRE & Salvar Versão'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: FINANCIAL ANALYSIS (DRE & INDICATORS) */}
          {activeTab === 'engine' && (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">DRE Gerencial & Motor Determinístico</h2>
                    <p className="text-slate-400 text-sm">
                      Período {activePeriodLabel} · {activeDre.taxNote || 'Cálculo Decimal.js no backend'}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { key: 'contributionMargin', label: 'Explicar MC' },
                      { key: 'operatingBreakEven', label: 'Explicar PE' },
                      { key: 'cashConversionCycle', label: 'Explicar Ciclo' },
                    ].map(btn => (
                      <button
                        key={btn.key}
                        onClick={() => handleExplainMetric(btn.key)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-indigo-300 flex items-center gap-1 border border-slate-700"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>{btn.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {explainedMetric && (
                  <div className="p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/30 text-xs space-y-1.5">
                    <div className="font-bold text-indigo-300">{explainedMetric.metric} — Explicabilidade</div>
                    <div className="text-slate-200">
                      <strong>Fórmula:</strong> {explainedMetric.formula}
                    </div>
                    <div className="text-slate-300 font-mono">
                      <strong>Entradas:</strong> {JSON.stringify(explainedMetric.inputs)} → <strong>Resultado:</strong> {explainedMetric.result}
                    </div>
                    <div className="text-slate-400">
                      <strong>Limitação:</strong> {explainedMetric.limitations}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 space-y-2.5 text-sm">
                    {[
                      { item: 'Receita Bruta', value: `R$ ${Number(activeDre.grossRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { item: '(-) Deduções e Tributos sobre Faturamento', value: `R$ ${Number(activeDre.deductions).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { item: '= Receita Líquida', value: `R$ ${Number(activeDre.netRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, bold: true },
                      { item: '(-) CMV / CPV', value: `R$ ${Number(activeDre.cmv).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { item: '(-) Despesas Variáveis de Venda', value: `R$ ${Number(activeDre.variableExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      {
                        item: '= Margem de Contribuição',
                        value: `R$ ${Number(activeDre.contributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${activeDre.contributionMarginPercentage}%)`,
                        highlight: true,
                      },
                      { item: '(-) Despesas Fixas Operacionais (Caixa)', value: `R$ ${Number(activeDre.fixedExpenses).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      {
                        item: '= Resultado Operacional Gerencial de Caixa',
                        value: `R$ ${Number(activeDre.operatingResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${activeDre.operatingResultPercentage}%)`,
                        highlight: true,
                      },
                      { item: '(-) Depreciação e Amortização', value: `R$ ${Number(activeDre.depreciation).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { item: '= EBIT', value: `R$ ${Number(activeDre.ebit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, bold: true },
                      { item: '(=) EBITDA', value: `R$ ${Number(activeDre.ebitda).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { item: '(+/-) Resultado Financeiro Líquido', value: `R$ ${Number(activeDre.financialResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      { item: '= LAIR', value: `R$ ${Number(activeDre.lair).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, bold: true },
                      { item: '(-) IRPJ / CSLL sobre Resultado', value: `R$ ${Number(activeDre.taxes).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` },
                      {
                        item: '= Lucro Líquido Gerencial',
                        value: `R$ ${Number(activeDre.netProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${activeDre.netProfitPercentage}%)`,
                        highlight: true,
                      },
                    ].map((row, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl flex justify-between items-center ${
                          row.highlight
                            ? 'bg-indigo-950/40 border border-indigo-500/30 font-bold text-indigo-300'
                            : row.bold
                              ? 'bg-slate-950 font-semibold text-white'
                              : 'bg-slate-950/50 text-slate-300'
                        }`}
                      >
                        <span className="text-xs sm:text-sm">{row.item}</span>
                        <span className="font-mono tabular-nums text-xs sm:text-sm">{row.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Indicators & Missing Data Column */}
                  <div className="lg:col-span-5 space-y-4 text-xs">
                    <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                      <h3 className="font-bold text-white text-sm">Indicadores de Liquidez, Giro & Equilíbrio</h3>
                      <div className="space-y-2 font-mono tabular-nums">
                        {[
                          ['Margem Bruta', activeIndicators.grossMargin ? `${activeIndicators.grossMargin}%` : 'Ausente'],
                          ['Liquidez Corrente', activeIndicators.currentLiquidity ? `${activeIndicators.currentLiquidity}x` : 'Ausente'],
                          ['Liquidez Seca', activeIndicators.quickLiquidity ? `${activeIndicators.quickLiquidity}x` : 'Ausente'],
                          ['PME (Dias Estoque)', activeIndicators.inventoryTurnoverDays ? `${activeIndicators.inventoryTurnoverDays} dias` : 'Ausente'],
                          ['PMR (Dias Receb.)', activeIndicators.receivablesDays ? `${activeIndicators.receivablesDays} dias` : 'Ausente'],
                          ['PMP (Dias Fornec.)', activeIndicators.payablesDays ? `${activeIndicators.payablesDays} dias` : 'Ausente'],
                          ['Ciclo Financeiro', activeIndicators.cashConversionCycle ? `${activeIndicators.cashConversionCycle} dias` : 'Ausente'],
                          ['Endividamento / Ativo', activeIndicators.debtToAssets ? `${activeIndicators.debtToAssets}%` : 'Ausente'],
                          ['ROE', activeIndicators.roe ? `${activeIndicators.roe}%` : 'Ausente'],
                          ['PE Operacional', `R$ ${Number(activeDre.operatingBreakEven).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
                          ['PE Financeiro', `R$ ${Number(activeDre.financialBreakEven).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
                        ].map(([k, v], i) => (
                          <div key={i} className="flex justify-between py-1 border-b border-slate-900">
                            <span className="font-sans text-slate-400">{k}</span>
                            <span className={v === 'Ausente' ? 'text-amber-300' : 'text-white'}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {activeIndicators.missingInformation?.length > 0 && (
                      <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                        <div className="font-bold text-amber-300">Campos Ausentes Identificados</div>
                        {activeIndicators.missingInformation.map((m: any, i: number) => (
                          <div key={i} className="text-amber-200/90">
                            • <strong>{m.field}:</strong> {m.impacts}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: MACROECONOMIC INTELLIGENCE */}
          {activeTab === 'macro' && (
            <div className="space-y-6 max-w-6xl mx-auto">
              <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Inteligência Macroeconômica (BCB / IBGE)</h2>
                    <p className="text-slate-400 text-sm">
                      Séries oficiais com código, frequência, data de publicação e conexão ao contexto econômico da empresa.
                    </p>
                  </div>
                  <button
                    onClick={handleSyncMacro}
                    disabled={syncingMacro}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-2 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingMacro ? 'animate-spin' : ''}`} />
                    <span>Sincronizar Fontes Oficiais</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  {macroIndicators.map((ind, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedMacroCode(ind.code)}
                      className={`text-left p-5 rounded-2xl border transition ${
                        selectedMacroCode === ind.code
                          ? 'bg-indigo-950/30 border-indigo-500'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2 text-xs">
                        <span className="font-mono font-bold text-indigo-400">{ind.code} · {ind.seriesCode}</span>
                        <span className="text-slate-500">{ind.syncSource === 'LIVE_API' ? 'API Ao Vivo' : 'Cache Ref.'}</span>
                      </div>
                      <div className="font-semibold text-white mb-1">{ind.name}</div>
                      <div className="text-2xl font-bold text-indigo-300 font-mono tabular-nums">
                        {ind.value} {ind.unit}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-2 space-y-0.5">
                        <div>Fonte: {ind.source}</div>
                        <div>Ref.: {ind.referenceDate} · Freq.: {ind.frequency}</div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Selected Series History */}
                {macroHistory.length > 0 && (
                  <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-white">Série Histórica Recente: {selectedMacroCode}</span>
                      <span className="text-slate-400">{macroHistory[0]?.methodology}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                      {macroHistory.map((h, i) => (
                        <div key={i} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono tabular-nums">
                          <div className="text-slate-400 text-[11px]">{h.referenceDate}</div>
                          <div className="text-white font-bold mt-0.5">
                            {h.value} {h.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Business Economic Context */}
                {companyContext?.economicContext && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
                    <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="font-bold text-white text-sm">Impacto Quantitativo Calculado</div>
                      {companyContext.economicContext.quantitativeImpacts.map((q: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                          <div className="font-semibold text-indigo-300">{q.channel}</div>
                          <div className="text-white">{q.computedImpact}</div>
                          <div className="text-slate-400">{q.basis}</div>
                        </div>
                      ))}
                    </div>
                    <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="font-bold text-white text-sm">Contexto Econômico Qualitativo</div>
                      {companyContext.economicContext.qualitativeContext.map((q: any, i: number) => (
                        <div key={i} className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                          <div className="font-semibold text-slate-200">{q.channel} ({q.indicatorCode})</div>
                          <div className="text-slate-300">{q.observation}</div>
                          <div className="text-amber-300/80">{q.reasonQualitativeOnly}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: INTELLIGENT DIAGNOSTIC */}
          {activeTab === 'ai' && (
            <div className="space-y-6 max-w-5xl mx-auto">
              <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">Diagnóstico Executivo (Fatos vs. Hipóteses)</h2>
                    <p className="text-slate-400 text-sm">
                      Separação estruturada entre fatos observados, hipóteses, estimativas, riscos e recomendações acionáveis.
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateDiagnostic}
                    disabled={generatingDiagnostic}
                    className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 whitespace-nowrap shrink-0"
                  >
                    <Cpu className={`w-4 h-4 ${generatingDiagnostic ? 'animate-spin' : ''}`} />
                    <span>{generatingDiagnostic ? 'Gerando Análise...' : 'Gerar Diagnóstico Executivo'}</span>
                  </button>
                </div>

                {diagnosticResult ? (
                  <div className="space-y-6">
                    <div className="p-5 rounded-xl bg-indigo-950/40 border border-indigo-500/30 space-y-2">
                      <div className="text-xs font-mono text-indigo-300">
                        Provedor: {diagnosticResult.provider} · Modelo: {diagnosticResult.modelUsed}
                      </div>
                      {diagnosticResult.fallbackReason && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                          {diagnosticResult.fallbackReason}
                        </div>
                      )}
                      <p className="text-slate-200 text-sm leading-relaxed">{diagnosticResult.diagnostic}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="font-bold text-emerald-400">Fatos Diretamente Comprovados</div>
                        {diagnosticResult.facts?.map((f: string, i: number) => (
                          <div key={i} className="text-slate-300">• {f}</div>
                        ))}
                      </div>
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                        <div className="font-bold text-amber-300">Hipóteses a Confirmar</div>
                        {diagnosticResult.hypotheses?.map((h: string, i: number) => (
                          <div key={i} className="text-slate-300">• {h}</div>
                        ))}
                      </div>
                    </div>

                    {diagnosticResult.risks?.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-base font-bold text-white">Riscos Identificados</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          {diagnosticResult.risks.map((r: any, idx: number) => (
                            <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                              <div className="flex justify-between font-bold">
                                <span className="text-white">{r.title}</span>
                                <span className={r.severity === 'ALTA' ? 'text-rose-400' : 'text-amber-300'}>{r.severity}</span>
                              </div>
                              <div className="text-slate-400">{r.evidence}</div>
                              <div className="text-slate-300">Mitigação: {r.mitigation}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <h3 className="text-lg font-bold text-white">Recomendações Prioritárias</h3>
                    <div className="space-y-4">
                      {diagnosticResult.recommendations?.map((rec: any, idx: number) => (
                        <div key={idx} className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-sm">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-indigo-400">{rec.horizon}</span>
                            <span className="text-slate-400">Confiança: {rec.confidence}</span>
                          </div>
                          <div className="font-bold text-white text-base">{rec.problem}</div>
                          <p className="text-xs text-slate-300">
                            <strong className="text-slate-400">Evidência:</strong> {rec.evidence}
                          </p>
                          <p className="text-xs text-slate-300">
                            <strong className="text-slate-400">Ação Sugerida:</strong> {rec.action}
                          </p>
                          <p className="text-xs text-slate-300">
                            <strong className="text-slate-400">Impacto Esperado:</strong> {rec.impact}
                          </p>
                          <p className="text-xs text-slate-400 italic">Limitações: {rec.limitations}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl">
                    <BrainCircuit className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">Clique no botão acima para gerar o diagnóstico estruturado.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: TEXTILE & APPAREL SECTOR NEWS RADAR */}
          {activeTab === 'textile_news' && (
            <TextileSectorNewsView
              companyId={selectedCompanyId}
              companyName={currentCompany?.name || 'Empresa'}
              taxRegime={currentCompany?.taxRegime}
              activeDre={activeDre}
              onSuccessMsg={setSuccessMsg}
              onErrorMsg={setErrorMsg}
              onOpenSimulator={() => setActiveTab('simulator')}
            />
          )}

          {/* TAB 8: ENHANCED SIMULATOR */}
          {activeTab === 'simulator' && (
            <EnhancedSimulator
              companyId={selectedCompanyId}
              companyName={currentCompany?.name}
              taxRegime={currentCompany?.taxRegime}
              activePeriod={companyContext?.activePeriod}
              baseDre={activeDre}
              debts={activeDebts}
              onSuccessMsg={setSuccessMsg}
              onErrorMsg={setErrorMsg}
            />
          )}

          {/* TAB 9: AUTOMATION & REPORTS */}
          {activeTab === 'automation' && (
            <AutomationReportsView
              companyId={selectedCompanyId}
              companyName={currentCompany?.name || 'Empresa'}
              onSuccessMsg={setSuccessMsg}
              onErrorMsg={setErrorMsg}
              onDataUpdated={() => {
                if (selectedCompanyId) fetchCompanyDetails(selectedCompanyId);
              }}
            />
          )}

          {/* TAB 10: HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-6 max-w-5xl mx-auto">
              <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl">
                <h2 className="text-2xl font-bold text-white mb-2">Histórico de Versões e Períodos</h2>
                <p className="text-slate-400 text-sm mb-6">Versões auditáveis de períodos financeiros geradas pelo sistema.</p>

                {periodsHistory.length === 0 ? (
                  <p className="text-slate-400 text-sm">Nenhum histórico registrado.</p>
                ) : (
                  <div className="space-y-4 text-sm">
                    {periodsHistory.map((p: any) => (
                      <div key={p.id} className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-white">
                            Período: {p.month ? `${String(p.month).padStart(2, '0')}/` : ''}
                            {p.year} ({p.periodType})
                          </span>
                          <span className="text-xs text-slate-400">{p.versions?.length || 0} versão(ões)</span>
                        </div>
                        <div className="space-y-2">
                          {p.versions?.map((v: any) => (
                            <div
                              key={v.id}
                              className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-wrap justify-between items-center gap-2 text-xs"
                            >
                              <div>
                                <span className="font-semibold text-indigo-400 mr-3 font-mono">v{v.versionNumber}</span>
                                <span className="text-slate-200 font-mono tabular-nums">
                                  Receita Líq.: R$ {Number(v.netRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Lucro: R${' '}
                                  {Number(v.netProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </span>
                                {v.changeReason && <div className="text-slate-400 mt-1">{v.changeReason}</div>}
                              </div>
                              <span className="text-slate-500 font-mono">{new Date(v.createdAt).toLocaleDateString('pt-BR')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 11: MEMORY & GOVERNANCE */}
          {activeTab === 'memory' && (
            <MemoryGovernanceView
              companyId={selectedCompanyId}
              companyName={currentCompany?.name || 'Empresa'}
              onSuccessMsg={setSuccessMsg}
              onErrorMsg={setErrorMsg}
            />
          )}
        </main>
      </div>
    </div>
  );
}
