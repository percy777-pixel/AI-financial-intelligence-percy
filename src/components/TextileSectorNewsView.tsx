import React, { useState, useEffect } from 'react';
import {
  Newspaper,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Sparkles,
  BookmarkPlus,
  Sliders,
  Factory,
  Shirt,
  Layers,
  CalendarClock,
  Globe,
  Scale,
  CloudSun,
  ArrowRight,
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';

export type SectorNewsTopic =
  | 'GERAL'
  | 'INSUMOS_CAMBIO'
  | 'TRIBUTACAO_IMPORTADOS'
  | 'VAREJO_CONSUMO'
  | 'CLIMA_ESTOQUES'
  | 'SUSTENTABILIDADE_INOVACAO';

interface GroundingSourceLink {
  title: string;
  uri: string;
}

interface SectorNewsAlertItem {
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

interface SectorNewsRadarResponse {
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
    horizon: string;
    area: string;
    action: string;
    expectedProtection: string;
  }>;
  groundingSources: GroundingSourceLink[];
  searchQueries: string[];
  fallbackReason?: string;
}

interface TextileSectorNewsViewProps {
  companyId: string;
  companyName: string;
  taxRegime?: string;
  activeDre?: any;
  onSuccessMsg: (msg: string) => void;
  onErrorMsg: (msg: string) => void;
  onOpenSimulator?: () => void;
}

const TOPIC_OPTIONS: Array<{
  id: SectorNewsTopic;
  label: string;
  shortDesc: string;
  icon: any;
}> = [
  {
    id: 'GERAL',
    label: 'Visão Geral do Setor',
    shortDesc: 'ABIT, confecção, varejo de moda e principais alertas',
    icon: Shirt,
  },
  {
    id: 'INSUMOS_CAMBIO',
    label: 'Matéria-Prima, Algodão & Câmbio',
    shortDesc: 'Fios, malhas, poliéster, dólar e pressão no CMV',
    icon: Factory,
  },
  {
    id: 'TRIBUTACAO_IMPORTADOS',
    label: 'Tributação & Concorrência Asiática',
    shortDesc: 'Reforma Tributária (IVA), ICMS, Remessa Conforme e importados',
    icon: Scale,
  },
  {
    id: 'VAREJO_CONSUMO',
    label: 'Varejo, Crédito & Consumo',
    shortDesc: 'Vendas PMC/IBGE, juros no parcelamento e poder de compra',
    icon: TrendingUp,
  },
  {
    id: 'CLIMA_ESTOQUES',
    label: 'Clima, Sazonalidade & Estoques',
    shortDesc: 'Inverno/verão atípicos, giro de coleção e markdowns',
    icon: CloudSun,
  },
  {
    id: 'SUSTENTABILIDADE_INOVACAO',
    label: 'Inovação, Facções & ESG',
    shortDesc: 'Automação, produtividade têxtil e rastreabilidade',
    icon: Layers,
  },
];

export const TextileSectorNewsView: React.FC<TextileSectorNewsViewProps> = ({
  companyId,
  companyName,
  taxRegime,
  activeDre,
  onSuccessMsg,
  onErrorMsg,
  onOpenSimulator,
}) => {
  const [selectedTopic, setSelectedTopic] = useState<SectorNewsTopic>('GERAL');
  const [customQuery, setCustomQuery] = useState<string>('');
  const [radarData, setRadarData] = useState<SectorNewsRadarResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [savingMemoryId, setSavingMemoryId] = useState<string | null>(null);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [quickSimResult, setQuickSimResult] = useState<{
    alertId: string;
    label: string;
    baseNetProfit: string;
    simulatedNetProfit: string;
    netProfitDiff: string;
    simulatedMarginPct: string;
  } | null>(null);

  const fetchSectorNews = async (topicOverride?: SectorNewsTopic, queryOverride?: string) => {
    const targetTopic = topicOverride || selectedTopic;
    const targetQuery = queryOverride !== undefined ? queryOverride : customQuery;
    setLoading(true);
    try {
      const res = await apiFetch('/api/sector-news/textile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(companyId ? { 'X-Company-Context': companyId } : {}),
        },
        body: JSON.stringify({
          companyId: companyId || undefined,
          topic: targetTopic,
          customQuery: targetQuery.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Não foi possível carregar o radar do setor têxtil.');
      }
      setRadarData(data);
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSectorNews('GERAL', '');
  }, [companyId]);

  const handleTopicSelect = (topic: SectorNewsTopic) => {
    setSelectedTopic(topic);
    setQuickSimResult(null);
    fetchSectorNews(topic, customQuery);
  };

  const handleCustomSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuickSimResult(null);
    fetchSectorNews(selectedTopic, customQuery);
  };

  const handleSaveAlertToMemory = async (alert: SectorNewsAlertItem) => {
    if (!companyId) {
      onErrorMsg('Selecione uma empresa para salvar o plano de preparação na Memória Operacional.');
      return;
    }
    setSavingMemoryId(alert.id);
    try {
      const res = await apiFetch(`/api/companies/${companyId}/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({
          memoryType: 'RISK_ALERT',
          title: `[Radar Têxtil & Vestuário] ${alert.title}`,
          summary: `Urgência ${alert.urgency} (${alert.category}) — Impacto DRE: ${alert.financialDreImpact}. Preparação: ${alert.howToPrepare.join(' | ')}`,
          structuredData: alert,
          createdBy: 'Radar Setorial Têxtil (Google Search Grounding)',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar alerta na memória.');
      onSuccessMsg(`Plano de preparação "${alert.title}" registrado na Memória & Governança da empresa!`);
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSavingMemoryId(null);
    }
  };

  const handleRunQuickImpactSimulation = async (alert: SectorNewsAlertItem) => {
    if (!companyId || !alert.suggestedSimulation) return;
    setSimulatingId(alert.id);
    try {
      const res = await apiFetch('/api/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({
          companyId,
          simulationInput: {
            scenarioLabel: alert.suggestedSimulation.label,
            revenueChangePct: alert.suggestedSimulation.revenueChangePct,
            cmvChangePct: alert.suggestedSimulation.cmvChangePct,
            fixedExpensesChangePct: alert.suggestedSimulation.fixedExpensesChangePct,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao simular impacto na DRE.');
      setQuickSimResult({
        alertId: alert.id,
        label: alert.suggestedSimulation.label,
        baseNetProfit: data.baseNetProfit,
        simulatedNetProfit: data.simulatedNetProfit,
        netProfitDiff: data.netProfitDiff,
        simulatedMarginPct: data.simulatedNetProfitPercentage,
      });
      onSuccessMsg(`Impacto de "${alert.suggestedSimulation.label}" calculado sobre a DRE de ${companyName}!`);
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSimulatingId(null);
    }
  };

  const getUrgencyBadge = (urgency: SectorNewsAlertItem['urgency']) => {
    switch (urgency) {
      case 'ALTA':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
      case 'MÉDIA':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
      default:
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    }
  };

  const getImpactBadge = (direction: SectorNewsAlertItem['impactDirection']) => {
    switch (direction) {
      case 'PRESSAO_CUSTO':
        return {
          label: 'Pressão em Custos / CMV',
          classes: 'bg-rose-950/80 text-rose-300 border-rose-500/30',
          icon: TrendingDown,
        };
      case 'RISCO_RECEITA':
        return {
          label: 'Risco de Demanda / Giro',
          classes: 'bg-amber-950/80 text-amber-300 border-amber-500/30',
          icon: AlertTriangle,
        };
      case 'REGULATORIO':
        return {
          label: 'Mudança Tributária / Regulatória',
          classes: 'bg-indigo-950/80 text-indigo-300 border-indigo-500/30',
          icon: Scale,
        };
      default:
        return {
          label: 'Oportunidade Competitiva',
          classes: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30',
          icon: TrendingUp,
        };
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="p-8 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/80 to-slate-900 border border-slate-800 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="px-2.5 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              <span>Google Search Grounding Ativo</span>
            </span>
            <span className="text-xs text-slate-400">
              Setor Têxtil, Confecção & Varejo de Vestuário · {companyName} ({taxRegime || 'Simples Nacional'})
            </span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <Newspaper className="w-7 h-7 text-indigo-400 shrink-0" />
            <span>Radar de Notícias & Preparação — Setor Têxtil e Vestuário</span>
          </h2>
          <p className="text-slate-300 text-sm leading-relaxed">
            Monitoramento em tempo real de notícias, insumos (algodão, fios sintéticos, câmbio), reforma tributária,
            concorrência de importados, clima e crédito no varejo de moda — traduzidos diretamente em impactos na DRE e
            planos práticos de preparação.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 w-full lg:w-auto">
          <button
            onClick={() => fetchSectorNews(selectedTopic, customQuery)}
            disabled={loading}
            className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Consultando Google Search...' : 'Atualizar Radar Setorial'}</span>
          </button>
        </div>
      </div>

      {/* Topic Selector & Custom Search Bar */}
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Recorte Temático do Setor Têxtil & Moda
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Selecione um vetor crítico do setor ou pesquise um tema específico via Google Search (gemini-4-hydrogen)
            </p>
          </div>

          <form onSubmit={handleCustomSearch} className="flex w-full md:w-96 gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={customQuery}
                onChange={e => setCustomQuery(e.target.value)}
                placeholder="Ex: preço do algodão, imposto importação Shein, inverno..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700 transition shrink-0 cursor-pointer"
            >
              Buscar
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TOPIC_OPTIONS.map(item => {
            const Icon = item.icon;
            const active = selectedTopic === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTopicSelect(item.id)}
                disabled={loading}
                className={`p-3.5 rounded-xl border text-left transition flex items-start gap-3 cursor-pointer ${
                  active
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md shadow-indigo-950/50'
                    : 'bg-slate-950/70 border-slate-800/90 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                    active ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-indigo-400'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{item.label}</div>
                  <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{item.shortDesc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="p-12 rounded-2xl bg-slate-900/70 border border-slate-800 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
          <div className="text-base font-bold text-white">
            Pesquisando notícias recentes do setor têxtil e de vestuário no Google Search...
          </div>
          <p className="text-xs text-slate-400 max-w-xl mx-auto">
            O modelo <code className="text-indigo-300">gemini-4-hydrogen</code> está cruzando notícias atuais da cadeia
            têxtil com a estrutura de DRE e margens de {companyName}.
          </p>
        </div>
      )}

      {!loading && radarData && (
        <>
          {/* Thermometer & Executive Synthesis */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                  <Sparkles className="w-4 h-4" />
                  <span>Síntese Executiva do Momento Setorial</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Fonte: {radarData.provider === 'GEMINI_SEARCH_GROUNDING' ? 'Google Search Grounding' : 'Base Setorial Têxtil'} · Modelo: {radarData.modelUsed}
                </div>
              </div>

              {radarData.fallbackReason && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                  {radarData.fallbackReason}
                </div>
              )}

              <p className="text-sm text-slate-200 leading-relaxed">{radarData.executiveBriefing}</p>

              {activeDre && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block">Contexto Financeiro Ativo ({companyName})</span>
                    <span className="text-slate-200 font-medium">
                      Sensibilidade direta do setor sobre CMV, Margem de Contribuição e Giro de Coleção
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-4 font-mono">
                    <div>
                      <span className="text-slate-400 block text-[10px]">CMV ATUAL</span>
                      <span className="text-white font-bold">
                        R$ {Number(activeDre.cmv || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">MARGEM CONTRIB.</span>
                      <span className="text-indigo-300 font-bold">{activeDre.contributionMarginPercentage || '0'}%</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px]">MARGEM LÍQUIDA</span>
                      <span className="text-emerald-300 font-bold">{activeDre.netProfitPercentage || '0'}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sector Thermometer 4 Pillars */}
            <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Termômetro de Risco Têxtil & Moda</span>
              </h3>
              <div className="space-y-2.5 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] font-semibold text-indigo-300 uppercase">
                    1. Insumos (Algodão, Fios & Câmbio)
                  </div>
                  <div className="text-slate-300 mt-0.5">{radarData.macroTextileThermometer.rawMaterialPressure}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] font-semibold text-indigo-300 uppercase">
                    2. Importados & Tributação
                  </div>
                  <div className="text-slate-300 mt-0.5">{radarData.macroTextileThermometer.importCompetitionRisk}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] font-semibold text-indigo-300 uppercase">
                    3. Demanda no Varejo & Crédito
                  </div>
                  <div className="text-slate-300 mt-0.5">{radarData.macroTextileThermometer.retailDemandOutlook}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[11px] font-semibold text-indigo-300 uppercase">
                    4. Capital de Giro & Coleções
                  </div>
                  <div className="text-slate-300 mt-0.5">{radarData.macroTextileThermometer.workingCapitalAlert}</div>
                </div>
              </div>
            </div>
          </div>

          {/* News Cards & Actionable Preparation */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-indigo-400" />
                <span>Notícias e Fatores de Impacto que Exigem Preparação ({radarData.newsAlerts.length})</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {radarData.newsAlerts.map(alert => {
                const impactBadge = getImpactBadge(alert.impactDirection);
                const ImpactIcon = impactBadge.icon;
                const isSimResultForThis = quickSimResult?.alertId === alert.id;

                return (
                  <div
                    key={alert.id}
                    className="p-6 rounded-2xl bg-slate-900/85 border border-slate-800/90 shadow-xl flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px] font-semibold">
                          {alert.category}
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 ${impactBadge.classes}`}
                          >
                            <ImpactIcon className="w-3 h-3" />
                            <span>{impactBadge.label}</span>
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold ${getUrgencyBadge(
                              alert.urgency
                            )}`}
                          >
                            Urgência {alert.urgency}
                          </span>
                        </div>
                      </div>

                      <h4 className="text-base font-bold text-white leading-snug">{alert.title}</h4>
                      <div className="text-[11px] text-slate-400">{alert.publishedContext}</div>

                      <p className="text-xs text-slate-300 leading-relaxed">{alert.summary}</p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
                          <div className="text-[11px] font-bold text-amber-300">Impacto no Setor Têxtil/Moda</div>
                          <p className="text-xs text-slate-300 leading-relaxed">{alert.sectorImpact}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
                          <div className="text-[11px] font-bold text-indigo-300">Reflexo na DRE & Caixa</div>
                          <p className="text-xs text-slate-300 leading-relaxed">{alert.financialDreImpact}</p>
                        </div>
                      </div>

                      {/* How to Prepare Box */}
                      <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/25 space-y-2">
                        <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Como a Empresa Precisa se Preparar:</span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-200">
                          {alert.howToPrepare.map((step, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-emerald-400 font-bold">•</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Quick Stress Test Result if triggered */}
                      {isSimResultForThis && quickSimResult && (
                        <div className="p-3.5 rounded-xl bg-indigo-950/50 border border-indigo-500/40 text-xs space-y-1.5">
                          <div className="flex items-center justify-between font-bold text-indigo-200">
                            <span>Simulação de Impacto na DRE ({quickSimResult.label})</span>
                            {onOpenSimulator && (
                              <button
                                onClick={onOpenSimulator}
                                className="text-indigo-300 hover:text-white underline flex items-center gap-1 cursor-pointer"
                              >
                                <span>Abrir no Simulador</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-4 font-mono text-slate-200 pt-1">
                            <span>
                              Lucro Base: R${' '}
                              {Number(quickSimResult.baseNetProfit).toLocaleString('pt-BR', {
                                minimumFractionDigits: 2,
                              })}
                            </span>
                            <span>
                              Lucro Pós-Impacto: R${' '}
                              {Number(quickSimResult.simulatedNetProfit).toLocaleString('pt-BR', {
                                minimumFractionDigits: 2,
                              })}
                            </span>
                            <span
                              className={
                                Number(quickSimResult.netProfitDiff) >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                              }
                            >
                              Δ R${' '}
                              {Number(quickSimResult.netProfitDiff).toLocaleString('pt-BR', {
                                minimumFractionDigits: 2,
                              })}{' '}
                              (Margem: {quickSimResult.simulatedMarginPct}%)
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer Actions & Source Link */}
                    <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        {alert.suggestedSimulation && (
                          <button
                            onClick={() => handleRunQuickImpactSimulation(alert)}
                            disabled={simulatingId === alert.id}
                            className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-200 font-medium flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>
                              {simulatingId === alert.id
                                ? 'Calculando DRE...'
                                : `Testar Impacto na DRE (${
                                    alert.suggestedSimulation.cmvChangePct
                                      ? `CMV ${alert.suggestedSimulation.cmvChangePct > 0 ? '+' : ''}${alert.suggestedSimulation.cmvChangePct}%`
                                      : `Receita ${alert.suggestedSimulation.revenueChangePct > 0 ? '+' : ''}${alert.suggestedSimulation.revenueChangePct}%`
                                  })`}
                            </span>
                          </button>
                        )}

                        <button
                          onClick={() => handleSaveAlertToMemory(alert)}
                          disabled={savingMemoryId === alert.id}
                          className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <BookmarkPlus className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{savingMemoryId === alert.id ? 'Salvando...' : 'Salvar Plano na Memória'}</span>
                        </button>
                      </div>

                      {alert.sourceUrl && (
                        <a
                          href={alert.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium truncate max-w-[220px]"
                          title={alert.sourceTitle || alert.sourceUrl}
                        >
                          <span className="truncate">{alert.sourceTitle || 'Fonte Verificada'}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Executive Preparation Checklist Matrix */}
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-emerald-400" />
                  <span>Plano Diretor de Preparação para Confecção & Varejo de Vestuário</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cronograma tático para blindar margens, compras de matéria-prima e capital de giro nos próximos 90 dias
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {radarData.preparationChecklist.map((item, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px] font-bold">
                        {item.horizon}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-400">{item.area}</span>
                    </div>
                    <p className="text-xs text-slate-200 font-medium leading-relaxed">{item.action}</p>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 text-[11px] text-emerald-300/90">
                    <strong>Proteção esperada:</strong> {item.expectedProtection}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Verified Google Search Grounding Sources */}
          <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  Fontes e Referências Verificadas (Google Search Grounding)
                </h3>
              </div>
              {radarData.searchQueries?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {radarData.searchQueries.slice(0, 4).map((q, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-slate-400"
                    >
                      🔍 {q}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {radarData.groundingSources?.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {radarData.groundingSources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40 flex items-center justify-between gap-2 text-xs text-slate-300 hover:text-indigo-300 transition"
                  >
                    <span className="truncate font-medium">{src.title}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Consulte os links acima em cada card de alerta para acessar as referências setoriais (ABIT, IEMI, IBGE e imprensa econômica).
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};
