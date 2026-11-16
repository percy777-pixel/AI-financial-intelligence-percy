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
  ShieldCheck,
  Database,
  Clock,
  Info,
  FlaskConical,
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
  verificationStatus: 'VERIFICADA_POR_GOOGLE_SEARCH' | 'REFERENCIA_INSTITUCIONAL_OFICIAL';
}

interface SectorSimulationParams {
  label: string;
  hypothesisNote: string;
  priceChangePercent: number;
  demandChangePercent: number;
  variableCostChangePercent: number;
  fixedExpenseChangePercent: number;
  selicShockPercent?: number;
}

interface StructuredPreparationRecommendation {
  id: string;
  horizon: string;
  area: string;
  problem: string;
  financialImpact: string;
  urgency: 'ALTA' | 'MÉDIA' | 'BAIXA';
  urgencyJustification: string;
  recommendedAction: string;
  suggestedDeadline: string;
  monitoredIndicator: string;
  requiredTrackingData: string;
  expectedProtection: string;
  action: string;
}

interface SectorNewsAlertItem {
  id: string;
  title: string;
  category: string;
  topic: SectorNewsTopic;
  publishedContext: string;
  publishedDate: string;
  recencyType: 'ACONTECIMENTO_RECENTE' | 'TENDENCIA_ESTRUTURAL_EM_CURSO' | 'CENARIO_DE_REFERENCIA_SETORIAL';
  urgency: 'ALTA' | 'MÉDIA' | 'BAIXA';
  urgencyJustification: string;
  impactDirection: 'PRESSAO_CUSTO' | 'RISCO_RECEITA' | 'OPORTUNIDADE' | 'REGULATORIO';
  summary: string;
  confirmedFact: string;
  sectorEconomicEffect: string;
  companySpecificImpact: string;
  missingCompanyData: string[];
  sectorImpact: string;
  financialDreImpact: string;
  howToPrepare: string[];
  monitoredIndicators: string[];
  suggestedSimulation: SectorSimulationParams;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceVerified: boolean;
  sourceVerificationStatus:
    | 'VERIFICADA_POR_GOOGLE_SEARCH'
    | 'REFERENCIA_INSTITUCIONAL_OFICIAL'
    | 'NAO_VERIFICADA_SEM_LINK';
}

interface SectorNewsRadarResponse {
  provider: 'GEMINI_SEARCH_GROUNDING' | 'LOCAL_CURATED_FALLBACK';
  modelUsed: string;
  searchGroundingOperational: boolean;
  verificationNotice: string;
  topic: SectorNewsTopic;
  customQuery?: string;
  generatedAt: string;
  cacheMetadata: {
    cached: boolean;
    fetchedAt: string;
    expiresAt: string;
    ttlSeconds: number;
  };
  companyContextSummary: string;
  companyMissingDataSummary: string[];
  executiveBriefing: string;
  macroTextileThermometer: {
    rawMaterialPressure: string;
    importCompetitionRisk: string;
    retailDemandOutlook: string;
    workingCapitalAlert: string;
  };
  newsAlerts: SectorNewsAlertItem[];
  preparationChecklist: StructuredPreparationRecommendation[];
  controlledStressBenchmarkCases: Array<{
    caseId: 'CASO_A_ALGODAO' | 'CASO_B_CAMBIO' | 'CASO_C_DEMANDA';
    title: string;
    description: string;
    hypothesisDisclaimer: string;
    simulationInput: SectorSimulationParams;
  }>;
  groundingSources: GroundingSourceLink[];
  searchQueries: string[];
  fallbackReason?: string;
}

interface QuickSimulationResult {
  targetId: string;
  label: string;
  hypothesisNote: string;
  taxRegime: string;
  baseNetRevenue: string;
  simulatedNetRevenue: string;
  netRevenueDiff: string;
  baseCmv: string;
  simulatedCmv: string;
  baseContributionMargin: string;
  simulatedContributionMargin: string;
  baseOperatingResult: string;
  simulatedOperatingResult: string;
  operatingResultDiff: string;
  baseNetProfit: string;
  simulatedNetProfit: string;
  netProfitDiff: string;
  simulatedMarginPct: string;
  assumptions: string[];
}

interface TextileSectorNewsViewProps {
  companyId: string;
  companyName: string;
  taxRegime?: string;
  activePeriod?: {
    year: number;
    month?: number | null;
    versionNumber: number;
  } | null;
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
    label: '1. Visão Geral do Setor',
    shortDesc: 'ABIT, IEMI, confecção, varejo de vestuário e principais alertas',
    icon: Shirt,
  },
  {
    id: 'INSUMOS_CAMBIO',
    label: '2. Matéria-Prima, Algodão & Câmbio',
    shortDesc: 'Algodão, fios sintéticos, poliéster, dólar PTAX e pressão no CMV',
    icon: Factory,
  },
  {
    id: 'TRIBUTACAO_IMPORTADOS',
    label: '3. Tributação & Concorrência Asiática',
    shortDesc: 'Reforma Tributária (IVA), ICMS, Remessa Conforme e importados',
    icon: Scale,
  },
  {
    id: 'VAREJO_CONSUMO',
    label: '4. Varejo, Crédito & Consumidor',
    shortDesc: 'Vendas PMC/IBGE, Selic no parcelamento e intenção de consumo',
    icon: TrendingUp,
  },
  {
    id: 'CLIMA_ESTOQUES',
    label: '5. Clima, Sazonalidade & Estoques',
    shortDesc: 'Inverno/verão atípicos, giro de coleção, Open-to-Buy e markdowns',
    icon: CloudSun,
  },
  {
    id: 'SUSTENTABILIDADE_INOVACAO',
    label: '6. Inovação, Facções & ESG',
    shortDesc: 'Automação de corte, produtividade de facções e rastreabilidade ABVTEX',
    icon: Layers,
  },
];

export const TextileSectorNewsView: React.FC<TextileSectorNewsViewProps> = ({
  companyId,
  companyName,
  taxRegime,
  activePeriod,
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
  const [savedMemoryIds, setSavedMemoryIds] = useState<Record<string, { id: string; isPersisted: boolean }>>({});
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [simResultsById, setSimResultsById] = useState<Record<string, QuickSimulationResult>>({});

  const periodRefLabel = activePeriod
    ? `${activePeriod.month ? `${String(activePeriod.month).padStart(2, '0')}/` : ''}${activePeriod.year}`
    : undefined;
  const versionRefLabel = activePeriod ? `v${activePeriod.versionNumber}` : undefined;

  const fetchSectorNews = async (
    topicOverride?: SectorNewsTopic,
    queryOverride?: string,
    forceRefresh = false
  ) => {
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
          forceRefresh,
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
    setSimResultsById({});
    setSavedMemoryIds({});
    fetchSectorNews(selectedTopic, customQuery, false);
  }, [companyId]);

  const handleTopicSelect = (topic: SectorNewsTopic) => {
    setSelectedTopic(topic);
    fetchSectorNews(topic, customQuery, false);
  };

  const handleCustomSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSectorNews(selectedTopic, customQuery, false);
  };

  const executeDeterministicImpactSimulation = async (
    targetId: string,
    simParams: SectorSimulationParams
  ) => {
    if (!companyId) {
      onErrorMsg('Selecione uma empresa com dados financeiros para executar a simulação determinística.');
      return;
    }
    setSimulatingId(targetId);
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
            scenarioLabel: simParams.label,
            priceChangePercent: simParams.priceChangePercent,
            demandChangePercent: simParams.demandChangePercent,
            variableCostChangePercent: simParams.variableCostChangePercent,
            fixedExpenseChangePercent: simParams.fixedExpenseChangePercent,
            ...(simParams.selicShockPercent ? { selicShockPercent: simParams.selicShockPercent } : {}),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao simular impacto na DRE.');

      const simNetRev = Number(data.simulatedNetRevenue || 0);
      const simNetProf = Number(data.simulatedNetProfit || 0);
      const computedMarginPct = simNetRev > 0 ? ((simNetProf / simNetRev) * 100).toFixed(2) : '0.00';

      const resultObj: QuickSimulationResult = {
        targetId,
        label: simParams.label,
        hypothesisNote: simParams.hypothesisNote,
        taxRegime: data.taxRegime || taxRegime || 'Simples Nacional',
        baseNetRevenue: data.baseNetRevenue,
        simulatedNetRevenue: data.simulatedNetRevenue,
        netRevenueDiff: data.netRevenueDiff,
        baseCmv: data.baseCmv,
        simulatedCmv: data.simulatedCmv,
        baseContributionMargin: data.baseContributionMargin,
        simulatedContributionMargin: data.simulatedContributionMargin,
        baseOperatingResult: data.baseOperatingResult,
        simulatedOperatingResult: data.simulatedOperatingResult,
        operatingResultDiff: data.operatingResultDiff,
        baseNetProfit: data.baseNetProfit,
        simulatedNetProfit: data.simulatedNetProfit,
        netProfitDiff: data.netProfitDiff,
        simulatedMarginPct: computedMarginPct,
        assumptions: Array.isArray(data.assumptions) ? data.assumptions : [],
      };

      setSimResultsById(prev => ({ ...prev, [targetId]: resultObj }));
      onSuccessMsg(
        `Simulação determinística "${simParams.label}" calculada em Decimal.js (sem alterar os dados reais de ${companyName}).`
      );
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSimulatingId(null);
    }
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
          summary: `Urgência: ${alert.urgency} (${alert.urgencyJustification}) | Fato: ${alert.confirmedFact} | Impacto na Empresa: ${alert.companySpecificImpact} | Ações: ${alert.howToPrepare.join(' ; ')} | Indicadores: ${alert.monitoredIndicators.join(', ')}`,
          structuredData: {
            originNewsId: alert.id,
            originNewsTitle: alert.title,
            category: alert.category,
            topic: alert.topic,
            publishedDate: alert.publishedDate,
            sourceTitle: alert.sourceTitle,
            sourceUrl: alert.sourceUrl,
            sourceVerificationStatus: alert.sourceVerificationStatus,
            urgency: alert.urgency,
            urgencyJustification: alert.urgencyJustification,
            confirmedFact: alert.confirmedFact,
            sectorEconomicEffect: alert.sectorEconomicEffect,
            companySpecificImpact: alert.companySpecificImpact,
            missingCompanyData: alert.missingCompanyData,
            howToPrepare: alert.howToPrepare,
            monitoredIndicators: alert.monitoredIndicators,
            suggestedSimulation: alert.suggestedSimulation,
          },
          periodRef: periodRefLabel,
          dataVersionRef: versionRefLabel,
          createdBy: 'Radar Setorial Têxtil & Moda',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar alerta na memória.');
      setSavedMemoryIds(prev => ({
        ...prev,
        [alert.id]: { id: data.id, isPersisted: Boolean(data.isPersisted) },
      }));
      onSuccessMsg(
        data.duplicatePrevented
          ? `Este plano já estava salvo na Memória Operacional de ${companyName} (${data.persistenceMode === 'POSTGRESQL' ? 'PostgreSQL/Neon' : 'Memória Demo'} — duplicação evitada).`
          : `Plano de preparação salvo com sucesso em ${data.persistenceMode === 'POSTGRESQL' ? 'PostgreSQL/Neon' : 'Memória Demo'} (ID: ${data.id.slice(0, 8)})!`
      );
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSavingMemoryId(null);
    }
  };

  const handleSaveRecommendationToMemory = async (rec: StructuredPreparationRecommendation) => {
    if (!companyId) {
      onErrorMsg('Selecione uma empresa para salvar a recomendação na Memória Operacional.');
      return;
    }
    setSavingMemoryId(rec.id);
    try {
      const res = await apiFetch(`/api/companies/${companyId}/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({
          memoryType: 'DECISION',
          title: `[Plano Têxtil — ${rec.area}] ${rec.problem}`,
          summary: `Urgência: ${rec.urgency} (${rec.urgencyJustification}) | Prazo: ${rec.suggestedDeadline} | Impacto: ${rec.financialImpact} | Ação: ${rec.recommendedAction} | Monitorar: ${rec.monitoredIndicator} | Dados necessários: ${rec.requiredTrackingData}`,
          structuredData: rec,
          periodRef: periodRefLabel,
          dataVersionRef: versionRefLabel,
          createdBy: 'Plano Diretor Têxtil & Vestuário',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar recomendação.');
      setSavedMemoryIds(prev => ({
        ...prev,
        [rec.id]: { id: data.id, isPersisted: Boolean(data.isPersisted) },
      }));
      onSuccessMsg(
        data.duplicatePrevented
          ? `Recomendação já registrada para ${companyName} (sem duplicação).`
          : `Recomendação salva na Memória Operacional (${data.persistenceMode === 'POSTGRESQL' ? 'PostgreSQL/Neon' : 'Memória Demo'})!`
      );
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSavingMemoryId(null);
    }
  };

  const getUrgencyBadge = (urgency: 'ALTA' | 'MÉDIA' | 'BAIXA') => {
    switch (urgency) {
      case 'ALTA':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/40';
      case 'MÉDIA':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
      default:
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    }
  };

  const getRecencyBadge = (recency: SectorNewsAlertItem['recencyType']) => {
    switch (recency) {
      case 'ACONTECIMENTO_RECENTE':
        return {
          label: 'Acontecimento / Dado Recente',
          classes: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
        };
      case 'TENDENCIA_ESTRUTURAL_EM_CURSO':
        return {
          label: 'Tendência Estrutural em Curso',
          classes: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
        };
      default:
        return {
          label: 'Cenário de Referência Setorial',
          classes: 'bg-slate-800 text-slate-300 border-slate-700',
        };
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
          label: 'Oportunidade de Eficiência',
          classes: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30',
          icon: TrendingUp,
        };
    }
  };

  const formatSimButtonLabel = (sim: SectorSimulationParams) => {
    const parts: string[] = [];
    if (sim.variableCostChangePercent) {
      parts.push(`CMV ${sim.variableCostChangePercent > 0 ? '+' : ''}${sim.variableCostChangePercent}%`);
    }
    if (sim.demandChangePercent) {
      parts.push(`Demanda ${sim.demandChangePercent > 0 ? '+' : ''}${sim.demandChangePercent}%`);
    }
    if (sim.priceChangePercent) {
      parts.push(`Preço ${sim.priceChangePercent > 0 ? '+' : ''}${sim.priceChangePercent}%`);
    }
    if (sim.fixedExpenseChangePercent) {
      parts.push(`Fixas ${sim.fixedExpenseChangePercent > 0 ? '+' : ''}${sim.fixedExpenseChangePercent}%`);
    }
    return parts.length > 0 ? parts.join(' | ') : 'Simular Impacto';
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="p-6 lg:p-8 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/80 to-slate-900 border border-slate-800 shadow-xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="space-y-2 max-w-3xl">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 ${
                radarData?.searchGroundingOperational
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>
                {radarData?.searchGroundingOperational
                  ? 'Google Search Grounding Ao Vivo (Verificado)'
                  : 'Modo Contingência Setorial Auditável (Sem Links Inventados)'}
              </span>
            </span>
            <span className="text-xs text-slate-300 font-medium">
              {companyName} · {taxRegime || 'Simples Nacional'} {periodRefLabel ? `· Período ${periodRefLabel} (${versionRefLabel})` : ''}
            </span>
          </div>
          <h2 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
            <Newspaper className="w-7 h-7 text-indigo-400 shrink-0" />
            <span>Radar de Notícias & Preparação — Setor Têxtil e Vestuário</span>
          </h2>
          <p className="text-slate-300 text-sm leading-relaxed">
            Inteligência setorial para confecção, indústria têxtil e varejo de moda: separa rigorosamente{' '}
            <strong className="text-white">Fatos Confirmados</strong>,{' '}
            <strong className="text-white">Efeitos Econômicos no Setor</strong> e{' '}
            <strong className="text-white">Impacto Matemático na DRE da Empresa (Decimal.js)</strong>, indicando dados
            ausentes e planos práticos de preparação.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0 w-full lg:w-auto">
          <button
            onClick={() => fetchSectorNews(selectedTopic, customQuery, true)}
            disabled={loading}
            className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Consultando Radar...' : 'Forçar Nova Consulta'}</span>
          </button>
        </div>
      </div>

      {/* Topic Selector (6 Thematic Filters) & Custom Search Bar */}
      <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5 shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              6 Filtros Temáticos do Setor Têxtil & Vestuário
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Selecione um recorte temático ou pesquise um fator específico (algodão, câmbio, reforma tributária, inverno, facções)
            </p>
          </div>

          <form onSubmit={handleCustomSearch} className="flex w-full md:w-96 gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={customQuery}
                onChange={e => setCustomQuery(e.target.value)}
                placeholder="Ex: algodão, dólar, imposto importados, inverno..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            {customQuery && (
              <button
                type="button"
                onClick={() => {
                  setCustomQuery('');
                  fetchSectorNews(selectedTopic, '', false);
                }}
                className="px-2.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 text-xs border border-slate-800 cursor-pointer"
                title="Limpar filtro de busca"
              >
                ✕
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition shrink-0 cursor-pointer"
            >
              Pesquisar
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
            Processando inteligência do setor têxtil e cruzando com a DRE de {companyName}...
          </div>
          <p className="text-xs text-slate-400 max-w-xl mx-auto">
            Verificando fontes setoriais e calculando sensibilidade de CMV, Margem de Contribuição, Estoques e Caixa.
          </p>
        </div>
      )}

      {!loading && radarData && (
        <>
          {/* Verification Status & Executive Briefing */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                  <Sparkles className="w-4 h-4" />
                  <span>Síntese Executiva & Status de Verificação de Busca</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {radarData.cacheMetadata?.cached ? 'Cache Controlado' : 'Consulta Atualizada'} ·{' '}
                    {new Date(radarData.cacheMetadata?.fetchedAt || radarData.generatedAt).toLocaleTimeString('pt-BR')}
                  </span>
                </div>
              </div>

              <div
                className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                  radarData.searchGroundingOperational
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                }`}
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold">
                    Provedor: {radarData.provider} ({radarData.modelUsed})
                  </div>
                  <p className="leading-relaxed">{radarData.verificationNotice}</p>
                </div>
              </div>

              <p className="text-sm text-slate-200 leading-relaxed">{radarData.executiveBriefing}</p>

              {/* Active Company Financial Snapshot Bar */}
              {activeDre && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-white">
                      Base Financeira Real da Empresa ({companyName} · {periodRefLabel || 'Período Ativo'})
                    </span>
                    <span className="text-[11px] text-indigo-300 font-mono">
                      Motor Determinístico Decimal.js
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">RECEITA LÍQUIDA</span>
                      <span className="text-white font-bold">
                        R$ {Number(activeDre.netRevenue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">CMV / CUSTO PROD.</span>
                      <span className="text-rose-300 font-bold">
                        R$ {Number(activeDre.cmv || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">MARGEM CONTRIB.</span>
                      <span className="text-indigo-300 font-bold">
                        R$ {Number(activeDre.contributionMargin || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ({activeDre.contributionMarginPercentage || '0'}%)
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">LUCRO LÍQUIDO</span>
                      <span className="text-emerald-300 font-bold">
                        R$ {Number(activeDre.netProfit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ({activeDre.netProfitPercentage || '0'}%)
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sector Thermometer 4 Pillars */}
            <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-lg space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Termômetro Setorial Têxtil & Moda</span>
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
                    2. Importados & Reforma Tributária
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

          {/* Controlled Benchmark Stress Tests (Caso A: Algodão +10%, Caso B: Câmbio +10%, Caso C: Demanda -10%) */}
          {radarData.controlledStressBenchmarkCases?.length > 0 && (
            <div className="p-6 rounded-2xl bg-slate-900/90 border border-indigo-500/30 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <FlaskConical className="w-5 h-5 text-indigo-400" />
                    <span>Testes Controlados de Sensibilidade Setorial no Motor Determinístico (Decimal.js)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Simulações hipotéticas auditáveis sobre os dados reais de {companyName} — não alteram o banco de
                    dados nem misturam cenário potencial com resultado realizado.
                  </p>
                </div>
                {onOpenSimulator && (
                  <button
                    onClick={onOpenSimulator}
                    className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-semibold border border-slate-700 flex items-center gap-1.5 self-start cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Abrir Simulador Completo</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {radarData.controlledStressBenchmarkCases.map(bench => {
                  const simRes = simResultsById[bench.caseId];
                  return (
                    <div
                      key={bench.caseId}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3 text-xs"
                    >
                      <div className="space-y-2">
                        <div className="font-bold text-white text-sm">{bench.title}</div>
                        <p className="text-slate-300 leading-relaxed">{bench.description}</p>
                        <div className="text-[11px] text-amber-300/90 italic">{bench.hypothesisDisclaimer}</div>
                      </div>

                      {simRes && (
                        <div className="p-3 rounded-lg bg-indigo-950/40 border border-indigo-500/30 space-y-1.5 font-mono text-[11px]">
                          <div className="text-indigo-200 font-sans font-bold">
                            Resultado Hipotético ({simRes.taxRegime}):
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Receita Líq.:</span>
                            <span className="text-white">
                              R$ {Number(simRes.baseNetRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} → R${' '}
                              {Number(simRes.simulatedNetRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">CMV:</span>
                            <span className="text-white">
                              R$ {Number(simRes.baseCmv).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} → R${' '}
                              {Number(simRes.simulatedCmv).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Margem Contrib.:</span>
                            <span className="text-white">
                              R$ {Number(simRes.baseContributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} → R${' '}
                              {Number(simRes.simulatedContributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between pt-1 border-t border-indigo-500/20">
                            <span className="text-slate-300 font-bold">Lucro Líquido:</span>
                            <span
                              className={
                                Number(simRes.netProfitDiff) >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                              }
                            >
                              R$ {Number(simRes.simulatedNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (Δ R${' '}
                              {Number(simRes.netProfitDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                            </span>
                          </div>
                        </div>
                      )}

                      <button
                        onClick={() => executeDeterministicImpactSimulation(bench.caseId, bench.simulationInput)}
                        disabled={simulatingId === bench.caseId}
                        className="w-full py-2.5 px-3 rounded-xl bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 font-semibold flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Sliders className="w-3.5 h-3.5" />
                        <span>
                          {simulatingId === bench.caseId
                            ? 'Calculando no Motor Decimal.js...'
                            : `Executar ${bench.title.split('—')[0].trim()}`}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* News Cards with Mandatory 3-Layer Separation */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-indigo-400" />
                <span>
                  Notícias e Fatores Setoriais Analisados ({radarData.newsAlerts.length})
                </span>
              </h3>
              <span className="text-xs text-slate-400">
                Cada card distingue: 1. Fato Confirmado · 2. Efeito Setorial · 3. Impacto na Empresa & Lacunas
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {radarData.newsAlerts.map(alert => {
                const impactBadge = getImpactBadge(alert.impactDirection);
                const recencyBadge = getRecencyBadge(alert.recencyType);
                const ImpactIcon = impactBadge.icon;
                const simRes = simResultsById[alert.id];
                const savedInfo = savedMemoryIds[alert.id];

                return (
                  <div
                    key={alert.id}
                    className="p-6 rounded-2xl bg-slate-900/85 border border-slate-800/90 shadow-xl flex flex-col justify-between space-y-5"
                  >
                    <div className="space-y-3.5">
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 text-[11px] font-semibold">
                            {alert.category}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-medium ${recencyBadge.classes}`}
                          >
                            {recencyBadge.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
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
                            title={alert.urgencyJustification}
                          >
                            Urgência {alert.urgency}
                          </span>
                        </div>
                      </div>

                      <h4 className="text-base font-bold text-white leading-snug">{alert.title}</h4>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                        <span>📌 {alert.publishedContext}</span>
                        <span>🗓️ {alert.publishedDate}</span>
                      </div>

                      <div className="text-[11px] text-slate-400 bg-slate-950/70 px-3 py-2 rounded-lg border border-slate-800/70">
                        <strong className="text-slate-300">Justificativa de Urgência:</strong>{' '}
                        {alert.urgencyJustification}
                      </div>

                      {/* 3 Mandatory Analytical Layers (Audit Section 3) */}
                      <div className="space-y-2.5 pt-1">
                        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                          <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">
                            1. Fato Confirmado pela Notícia / Fonte Oficial
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed">{alert.confirmedFact}</p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                          <div className="text-[11px] font-bold text-amber-300 uppercase tracking-wide">
                            2. Possível Consequência Econômica para o Setor Têxtil & Moda
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed">{alert.sectorEconomicEffect}</p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-indigo-950/25 border border-indigo-500/30 space-y-2">
                          <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-wide">
                            3. Impacto Específico Estimado para {companyName} (Dados Cadastrados)
                          </div>
                          <p className="text-xs text-slate-200 leading-relaxed">{alert.companySpecificImpact}</p>

                          {alert.missingCompanyData?.length > 0 && (
                            <div className="pt-2 border-t border-indigo-500/20 space-y-1">
                              <div className="text-[11px] font-semibold text-amber-300">
                                Informações Internas Ausentes (Não Inventadas):
                              </div>
                              <ul className="space-y-0.5 text-[11px] text-slate-300">
                                {alert.missingCompanyData.map((m, idx) => (
                                  <li key={idx}>• {m}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* How to Prepare Box */}
                      <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/25 space-y-2">
                        <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Plano de Preparação Recomendado & Indicadores:</span>
                        </div>
                        <ul className="space-y-1.5 text-xs text-slate-200">
                          {alert.howToPrepare.map((step, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="text-emerald-400 font-bold">•</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                        {alert.monitoredIndicators?.length > 0 && (
                          <div className="pt-2 border-t border-emerald-500/20 text-[11px] text-emerald-200/90">
                            <strong>Indicadores a monitorar:</strong> {alert.monitoredIndicators.join(' · ')}
                          </div>
                        )}
                      </div>

                      {/* Quick Stress Test Result if triggered */}
                      {simRes && (
                        <div className="p-4 rounded-xl bg-indigo-950/50 border border-indigo-500/40 text-xs space-y-2">
                          <div className="flex items-center justify-between font-bold text-indigo-200">
                            <span>Simulação Hipotética na DRE ({simRes.label})</span>
                            {onOpenSimulator && (
                              <button
                                onClick={onOpenSimulator}
                                className="text-indigo-300 hover:text-white underline flex items-center gap-1 cursor-pointer"
                              >
                                <span>Simulador Avançado</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-300 italic">{simRes.hypothesisNote}</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px] pt-1">
                            <div className="p-2 rounded bg-slate-950/80">
                              <span className="text-slate-400 block text-[10px]">CMV (BASE → SIM)</span>
                              <span className="text-white">
                                R$ {Number(simRes.baseCmv).toLocaleString('pt-BR')} → R${' '}
                                {Number(simRes.simulatedCmv).toLocaleString('pt-BR')}
                              </span>
                            </div>
                            <div className="p-2 rounded bg-slate-950/80">
                              <span className="text-slate-400 block text-[10px]">RESULT. OPERACIONAL</span>
                              <span className="text-white">
                                R$ {Number(simRes.simulatedOperatingResult).toLocaleString('pt-BR')} (Δ R${' '}
                                {Number(simRes.operatingResultDiff).toLocaleString('pt-BR')})
                              </span>
                            </div>
                            <div className="p-2 rounded bg-slate-950/80 col-span-2 sm:col-span-1">
                              <span className="text-slate-400 block text-[10px]">LUCRO LÍQUIDO SIMULADO</span>
                              <span
                                className={
                                  Number(simRes.netProfitDiff) >= 0
                                    ? 'text-emerald-400 font-bold'
                                    : 'text-rose-400 font-bold'
                                }
                              >
                                R$ {Number(simRes.simulatedNetProfit).toLocaleString('pt-BR')} (Δ R${' '}
                                {Number(simRes.netProfitDiff).toLocaleString('pt-BR')} | {simRes.simulatedMarginPct}%)
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer Actions & Verified Source Link */}
                    <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        {alert.suggestedSimulation && (
                          <button
                            onClick={() =>
                              executeDeterministicImpactSimulation(alert.id, alert.suggestedSimulation)
                            }
                            disabled={simulatingId === alert.id}
                            className="px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-200 font-medium flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>
                              {simulatingId === alert.id
                                ? 'Calculando DRE...'
                                : `Testar na DRE (${formatSimButtonLabel(alert.suggestedSimulation)})`}
                            </span>
                          </button>
                        )}

                        <button
                          onClick={() => handleSaveAlertToMemory(alert)}
                          disabled={savingMemoryId === alert.id}
                          className={`px-3 py-1.5 rounded-xl border font-medium flex items-center gap-1.5 transition cursor-pointer ${
                            savedInfo
                              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                          }`}
                        >
                          <BookmarkPlus className="w-3.5 h-3.5 text-emerald-400" />
                          <span>
                            {savingMemoryId === alert.id
                              ? 'Persistindo...'
                              : savedInfo
                              ? `Salvo (${savedInfo.isPersisted ? 'Neon DB' : 'Memória'})`
                              : 'Salvar Plano na Memória'}
                          </span>
                        </button>
                      </div>

                      {alert.sourceUrl ? (
                        <a
                          href={alert.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium truncate max-w-[240px]"
                          title={`${alert.sourceTitle || alert.sourceUrl} (${alert.sourceVerificationStatus})`}
                        >
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                          <span className="truncate">{alert.sourceTitle || 'Fonte Verificada'}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-amber-300/80">
                          Sem link externo confirmado
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Complete 7-Field Executive Preparation Checklist Matrix (Audit Section 5) */}
          <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <CalendarClock className="w-5 h-5 text-emerald-400" />
                  <span>Plano Estruturado de Preparação Setorial (7 Critérios Executivos)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cada recomendação apresenta: Problema, Impacto Financeiro, Urgência/Justificativa, Ação, Prazo,
                  Indicador Monitorado e Dados Necessários — com persistência direta no PostgreSQL/Neon.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {radarData.preparationChecklist.map(item => {
                const savedRec = savedMemoryIds[item.id];
                return (
                  <div
                    key={item.id}
                    className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3 flex flex-col justify-between text-xs"
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="px-2.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold">
                          {item.horizon} · {item.area}
                        </span>
                        <span className={`px-2 py-0.5 rounded border font-bold ${getUrgencyBadge(item.urgency)}`}>
                          Urgência {item.urgency}
                        </span>
                      </div>

                      <div className="text-sm font-bold text-white">1. Problema: {item.problem}</div>

                      <div className="space-y-1.5 text-slate-300">
                        <div>
                          <strong className="text-slate-400">2. Possível Impacto Financeiro:</strong>{' '}
                          {item.financialImpact}
                        </div>
                        <div>
                          <strong className="text-slate-400">3. Justificativa de Urgência:</strong>{' '}
                          {item.urgencyJustification}
                        </div>
                        <div>
                          <strong className="text-emerald-300">4. Ação Recomendada:</strong> {item.recommendedAction}
                        </div>
                        <div>
                          <strong className="text-slate-400">5. Prazo Sugerido:</strong> {item.suggestedDeadline}
                        </div>
                        <div>
                          <strong className="text-indigo-300">6. Indicador a Monitorar:</strong>{' '}
                          {item.monitoredIndicator}
                        </div>
                        <div>
                          <strong className="text-amber-300">7. Dados Necessários p/ Acompanhamento:</strong>{' '}
                          {item.requiredTrackingData}
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-emerald-300/90 truncate">
                        Meta: {item.expectedProtection}
                      </span>
                      <button
                        onClick={() => handleSaveRecommendationToMemory(item)}
                        disabled={savingMemoryId === item.id}
                        className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                          savedRec
                            ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                        }`}
                      >
                        <Database className="w-3 h-3 text-indigo-400" />
                        <span>
                          {savingMemoryId === item.id
                            ? 'Gravando...'
                            : savedRec
                            ? `Persistido (${savedRec.isPersisted ? 'Neon' : 'Mem'})`
                            : 'Salvar Recomendação'}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Verified Sources & Missing Company Data Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-sm font-bold text-white">
                    Fontes e Entidades Setoriais Verificadas ({radarData.groundingSources?.length || 0})
                  </h3>
                </div>
                {radarData.searchQueries?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {radarData.searchQueries.slice(0, 3).map((q, i) => (
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {radarData.groundingSources?.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/40 flex items-center justify-between gap-2 text-xs text-slate-300 hover:text-indigo-300 transition"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-white">{src.title}</div>
                      <div className="text-[10px] text-emerald-400 font-mono mt-0.5">
                        {src.verificationStatus === 'VERIFICADA_POR_GOOGLE_SEARCH'
                          ? '✓ Link Grounding Google Search'
                          : '✓ Portal Institucional Oficial'}
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 text-indigo-400" />
                  </a>
                ))}
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Lacunas de Dados Internos ({companyName})</span>
              </h3>
              <p className="text-xs text-slate-400">
                Para refinar a precisão do impacto setorial sobre a empresa, o sistema identificou os seguintes dados
                ainda não cadastrados:
              </p>
              <ul className="space-y-2 text-xs text-slate-300">
                {radarData.companyMissingDataSummary?.map((item, i) => (
                  <li key={i} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 leading-relaxed">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
