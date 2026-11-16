import React, { useState, useEffect } from 'react';
import { Sliders, HelpCircle, BookmarkPlus, Layers, AlertTriangle, Landmark, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';

interface EnhancedSimulatorProps {
  companyId: string;
  companyName?: string;
  taxRegime?: string;
  activePeriod?: {
    year: number;
    month: number | null;
    versionNumber: number;
  } | null;
  baseDre: any;
  debts: any[];
  onSuccessMsg: (msg: string) => void;
  onErrorMsg: (msg: string) => void;
}

export const EnhancedSimulator: React.FC<EnhancedSimulatorProps> = ({
  companyId,
  companyName,
  taxRegime,
  activePeriod,
  baseDre,
  debts,
  onSuccessMsg,
  onErrorMsg,
}) => {
  const cdiDebtTotal = debts
    .filter(d => d.indexer === 'CDI')
    .reduce((acc, d) => acc + Number(d.outstandingBalance || 0), 0);

  const selicDebtTotal = debts
    .filter(d => d.indexer === 'SELIC')
    .reduce((acc, d) => acc + Number(d.outstandingBalance || 0), 0);

  const fixedOrOtherDebtTotal = debts
    .filter(d => d.indexer !== 'CDI' && d.indexer !== 'SELIC')
    .reduce((acc, d) => acc + Number(d.outstandingBalance || 0), 0);

  const floatingDebtTotal = cdiDebtTotal + selicDebtTotal;
  const totalDebtPortfolio = floatingDebtTotal + fixedOrOtherDebtTotal;

  const [priceShock, setPriceShock] = useState<number>(0);
  const [demandShock, setDemandShock] = useState<number>(0);
  const [vcShock, setVcShock] = useState<number>(0);
  const [feShock, setFeShock] = useState<number>(0);
  const [selicShock, setSelicShock] = useState<number>(0);
  const [elasticity, setElasticity] = useState<number>(0);
  // Never invent 500000 when floatingDebtTotal is 0; use exact floating debt from company's portfolio
  const [debtExposure, setDebtExposure] = useState<number>(floatingDebtTotal);
  const [simulating, setSimulating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [suiteResult, setSuiteResult] = useState<any>(null);
  const [showExplain, setShowExplain] = useState(false);

  const effectiveRegime = taxRegime || baseDre?.taxRegime || 'Simples Nacional';
  const periodLabel = activePeriod
    ? `${activePeriod.month ? `${String(activePeriod.month).padStart(2, '0')}/` : ''}${activePeriod.year} (v${activePeriod.versionNumber})`
    : 'Período Atual';

  // Synchronize debt exposure and clear stale simulation state whenever company, period, or debt portfolio changes
  useEffect(() => {
    setDebtExposure(floatingDebtTotal);
    setResult(null);
    setSuiteResult(null);
  }, [companyId, floatingDebtTotal, activePeriod?.year, activePeriod?.month, activePeriod?.versionNumber]);

  const buildInputPayload = () => ({
    scenarioLabel: 'Cenário Parametrizado pelo Gestor',
    priceChangePercent: priceShock,
    demandChangePercent: demandShock,
    variableCostChangePercent: vcShock,
    fixedExpenseChangePercent: feShock,
    selicShockPercent: selicShock,
    debtExposureValue: debtExposure,
    priceElasticityHypothesis: elasticity !== 0 ? elasticity : undefined,
    taxRegime: effectiveRegime,
    debtFacilities: debts,
  });

  const handleRunSimulation = async () => {
    setSimulating(true);
    try {
      const res = await apiFetch('/api/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(companyId ? { 'X-Company-Context': companyId } : {}),
        },
        body: JSON.stringify({
          companyId: companyId || undefined,
          year: activePeriod?.year,
          month: activePeriod?.month ?? undefined,
          baseDre: {
            ...baseDre,
            taxRegime: effectiveRegime,
          },
          simulationInput: buildInputPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na simulação');
      setResult(data);
      onSuccessMsg('Simulação determinística calculada com sucesso.');
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSimulating(false);
    }
  };

  const handleRunComparisonSuite = async () => {
    if (!companyId) return;
    setSimulating(true);
    try {
      const res = await apiFetch(`/api/companies/${companyId}/simulate/compare`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({
          year: activePeriod?.year,
          month: activePeriod?.month ?? undefined,
          simulationInput: buildInputPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na comparação de cenários');
      setSuiteResult(data);
      onSuccessMsg('Comparativo de 4 cenários gerado.');
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSimulating(false);
    }
  };

  const handleSaveScenarioMemory = async () => {
    if (!result || !companyId) return;
    try {
      const res = await apiFetch(`/api/companies/${companyId}/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({
          memoryType: 'SCENARIO',
          title: `Simulação (${periodLabel}): Preço ${priceShock}% | Demanda ${demandShock}% | Selic ${selicShock} p.p.`,
          summary: `Regime: ${effectiveRegime} | Receita simulada R$ ${Number(result.simulatedNetRevenue).toLocaleString('pt-BR')} | Lucro simulado R$ ${Number(result.simulatedNetProfit).toLocaleString('pt-BR')} (Δ R$ ${Number(result.netProfitDiff).toLocaleString('pt-BR')}).`,
          structuredData: result,
          periodRef: periodLabel,
          createdBy: 'Simulador de Decisões',
        }),
      });
      if (!res.ok) throw new Error('Falha ao salvar cenário.');
      onSuccessMsg('Cenário salvo na Memória Operacional.');
    } catch (err: any) {
      onErrorMsg(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-indigo-300 mb-1">
              {companyName || 'Empresa Selecionada'} · Regime: <span className="font-bold text-white">{effectiveRegime}</span> · Base: <span className="font-mono">{periodLabel}</span>
            </div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Sliders className="w-6 h-6 text-indigo-400" />
              <span>Simulador Avançado de Decisões</span>
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Separação estrita entre impacto financeiro bruto, efeito tributário por regime ({effectiveRegime}) e impacto líquido estimado.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPriceShock(0);
                setDemandShock(0);
                setVcShock(0);
                setFeShock(0);
                setElasticity(0);
                setSelicShock(2);
                setDebtExposure(350000);
              }}
              className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium flex items-center gap-1.5 border border-amber-500/30 whitespace-nowrap shrink-0"
              title="Carrega o caso de referência: dívida pós-fixada de R$ 350.000 indexada ao CDI com choque de +2 p.p."
            >
              <Landmark className="w-4 h-4 text-amber-400" />
              <span>Caso Ref.: Dívida CDI R$ 350k (+2 p.p.)</span>
            </button>
            <button
              type="button"
              onClick={() => setShowExplain(!showExplain)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 border border-slate-700 whitespace-nowrap shrink-0"
            >
              <HelpCircle className="w-4 h-4 text-indigo-400" />
              <span>{showExplain ? 'Ocultar Fórmulas' : 'Explicar Fórmulas'}</span>
            </button>
            <button
              type="button"
              onClick={handleRunComparisonSuite}
              disabled={simulating}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs font-medium flex items-center gap-1.5 border border-indigo-500/30 whitespace-nowrap shrink-0"
            >
              <Layers className="w-4 h-4" />
              <span>Comparar 4 Cenários</span>
            </button>
          </div>
        </div>

        {/* Debt Portfolio Breakdown Banner */}
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80">
            <div className="text-slate-400 flex items-center gap-1">
              <Landmark className="w-3.5 h-3.5 text-indigo-400" />
              <span>Exposição CDI</span>
            </div>
            <div className="font-mono font-bold text-white text-sm mt-1 tabular-nums">
              R$ {cdiDebtTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80">
            <div className="text-slate-400">Exposição Selic</div>
            <div className="font-mono font-bold text-white text-sm mt-1 tabular-nums">
              R$ {selicDebtTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/30">
            <div className="text-indigo-300 font-semibold">Total Pós-Fixada (CDI + Selic)</div>
            <div className="font-mono font-bold text-indigo-200 text-sm mt-1 tabular-nums">
              R$ {floatingDebtTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80">
            <div className="text-slate-400">Pré-Fixada / Outras (Imune no CP)</div>
            <div className="font-mono font-bold text-slate-300 text-sm mt-1 tabular-nums">
              R$ {fixedOrOtherDebtTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Carteira Total: R$ {totalDebtPortfolio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 text-sm">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                  <span>Variação de Preço (mantém CMV físico)</span>
                  <span className="font-mono text-indigo-300 tabular-nums">{priceShock > 0 ? `+${priceShock}` : priceShock}%</span>
                </div>
                <input
                  type="range"
                  min="-25"
                  max="25"
                  step="1"
                  value={priceShock}
                  onChange={e => setPriceShock(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                  <span>Variação de Demanda / Volume</span>
                  <span className="font-mono text-indigo-300 tabular-nums">{demandShock > 0 ? `+${demandShock}` : demandShock}%</span>
                </div>
                <input
                  type="range"
                  min="-40"
                  max="40"
                  step="1"
                  value={demandShock}
                  onChange={e => setDemandShock(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                  <span>Custo Unitário CMV / Variáveis</span>
                  <span className="font-mono text-indigo-300 tabular-nums">{vcShock > 0 ? `+${vcShock}` : vcShock}%</span>
                </div>
                <input
                  type="range"
                  min="-20"
                  max="30"
                  step="1"
                  value={vcShock}
                  onChange={e => setVcShock(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                  <span>Despesas Fixas Operacionais</span>
                  <span className="font-mono text-indigo-300 tabular-nums">{feShock > 0 ? `+${feShock}` : feShock}%</span>
                </div>
                <input
                  type="range"
                  min="-25"
                  max="25"
                  step="1"
                  value={feShock}
                  onChange={e => setFeShock(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold text-slate-300 mb-1.5">
                  <span>Choque na Taxa Selic / CDI</span>
                  <span className="font-mono text-indigo-300 tabular-nums">{selicShock > 0 ? `+${selicShock}` : selicShock} p.p.</span>
                </div>
                <input
                  type="range"
                  min="-5"
                  max="10"
                  step="0.5"
                  value={selicShock}
                  onChange={e => setSelicShock(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Dívida Pós-Fixada Exposta (R$)
                </label>
                <input
                  type="number"
                  min="0"
                  value={debtExposure}
                  onChange={e => setDebtExposure(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setDebtExposure(floatingDebtTotal)}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 mt-1"
                >
                  Restaurar carteira pós-fixada (R$ {floatingDebtTotal.toLocaleString('pt-BR')})
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Elasticidade-Preço (Hipótese)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={elasticity}
                  onChange={e => setElasticity(Number(e.target.value))}
                  placeholder="0 = sem elasticidade"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs tabular-nums"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunSimulation}
              disabled={simulating}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm shadow-lg shadow-indigo-600/25 transition"
            >
              {simulating ? 'Calculando Cenário...' : 'Executar Simulação Combinada'}
            </button>
          </div>

          {/* Results */}
          <div className="lg:col-span-7 p-6 rounded-xl bg-slate-950 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-base">Impacto Projetado (Condicional às Premissas)</h3>
              {result && (
                <button
                  type="button"
                  onClick={handleSaveScenarioMemory}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Salvar Cenário</span>
                </button>
              )}
            </div>

            {result ? (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Receita Líquida</div>
                    <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
                      R$ {Number(result.simulatedNetRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-slate-500 font-mono mt-0.5 tabular-nums">
                      Base: R$ {Number(result.baseNetRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Margem de Contribuição</div>
                    <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
                      R$ {Number(result.simulatedContributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-slate-500 font-mono mt-0.5 tabular-nums">
                      Base: R$ {Number(result.baseContributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Resultado Operacional</div>
                    <div className="text-base font-mono font-bold text-white mt-1 tabular-nums">
                      R$ {Number(result.simulatedOperatingResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <div className={`font-mono mt-0.5 tabular-nums ${Number(result.operatingResultDiff) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      Δ R$ {Number(result.operatingResultDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-400">Lucro Líquido Gerencial</div>
                    <div className="text-base font-mono font-bold text-indigo-300 mt-1 tabular-nums">
                      R$ {Number(result.simulatedNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                    <div className={`font-mono mt-0.5 tabular-nums ${Number(result.netProfitDiff) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      Δ R$ {Number(result.netProfitDiff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                {/* Explicit Tax & Financial Impact Separation Box (Section 3.3 & Section 8) */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-indigo-400" />
                      <span>Separação: Impacto Bruto vs. Efeito Tributário ({result.taxRegime})</span>
                    </span>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      {result.taxEffectStatus}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 font-mono tabular-nums">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                      <div className="text-slate-400 font-sans text-[11px]">Impacto Bruto Juros (Mensal / Anual)</div>
                      <div className={Number(result.grossFinancialImpact) <= 0 ? 'text-rose-400 font-semibold mt-0.5' : 'text-emerald-400 font-semibold mt-0.5'}>
                        R$ {Number(result.grossFinancialImpact || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Anual: R$ {Number(result.annualizedGrossInterestImpact || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/ano
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                      <div className="text-slate-400 font-sans text-[11px]">Efeito Tributário Estimado (IRPJ/CSLL)</div>
                      <div className="text-slate-200 font-semibold mt-0.5">
                        R$ {Number(result.estimatedTaxEffect || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
                      </div>
                      <div className="text-[11px] text-slate-500 font-sans">
                        {result.taxEffectStatus === 'NAO_APLICAVEL_NO_REGIME'
                          ? 'Sem escudo fiscal sobre juros'
                          : result.taxEffectStatus === 'NAO_MODELADO_SEM_LALUR'
                            ? 'LALUR ausente (bruto preservado)'
                            : 'Estimado por faixa legal'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80">
                      <div className="text-slate-400 font-sans text-[11px]">Impacto Líquido Total no Resultado</div>
                      <div className={Number(result.netFinancialImpact) >= 0 ? 'text-emerald-400 font-bold mt-0.5' : 'text-rose-400 font-bold mt-0.5'}>
                        R$ {Number(result.netFinancialImpact || result.netProfitDiff || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/mês
                      </div>
                    </div>
                  </div>
                  {result.taxMethodologyNote && (
                    <p className="text-[11px] text-slate-400 leading-relaxed pt-1">{result.taxMethodologyNote}</p>
                  )}
                </div>

                {/* Driver Attribution */}
                <div className="space-y-2 text-xs">
                  <div className="font-semibold text-slate-300">Decomposição da Diferença no Lucro Líquido</div>
                  {result.driverAttribution?.map((d: any, i: number) => (
                    <div key={i} className="flex justify-between items-center py-1.5 border-b border-slate-900">
                      <span className="text-slate-400">{d.driver}</span>
                      <span className={`font-mono font-semibold tabular-nums ${Number(d.impactOnNetProfit) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {Number(d.impactOnNetProfit) >= 0 ? '+' : ''}R$ {Number(d.impactOnNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Assumptions & Limitations */}
                <div className="text-xs text-slate-400 space-y-1.5 pt-2">
                  <div className="font-semibold text-slate-300">Hipóteses Explícitas & Limitações Metodológicas</div>
                  {result.assumptions?.map((a: string, i: number) => (
                    <div key={i}>• {a}</div>
                  ))}
                  {result.limitations?.map((l: string, i: number) => (
                    <div key={i} className="text-amber-300/80 flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-16 text-center text-xs text-slate-500">
                Ajuste as variáveis ao lado e execute a simulação combinada ou compare os 4 cenários para {companyName || 'a empresa ativa'}.
              </div>
            )}

            {showExplain && (
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs space-y-1.5 text-slate-300">
                <div className="font-semibold text-indigo-300">Fórmulas Auditadas do Simulador</div>
                <div>• Receita Bruta Simulada = Receita Base × (1 + ΔPreço%) × (1 + ΔDemanda%)</div>
                <div>• CMV Simulado = CMV Base × (1 + ΔDemanda%) × (1 + ΔCustoVariável%)</div>
                <div>• Despesas Variáveis = Base × (1 + ΔPreço%) × (1 + ΔDemanda%) × (1 + ΔCustoVariável%)</div>
                <div>• Impacto Anual Juros = Dívida Pós-Fixada Exposta (CDI + Selic) × (ΔSelic p.p. / 100)</div>
                <div>• Impacto Mensal Bruto Juros = Impacto Anual Juros / 12 (hipótese de saldo constante em 12 meses e transmissão 1:1 Selic/CDI)</div>
                <div>• Tributos (Simples Nacional / Lucro Presumido): Sem escudo fiscal de IRPJ/CSLL sobre variação de despesas ou juros.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4-Scenario Comparison Matrix */}
      {suiteResult && (
        <div className="p-6 lg:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-white">Comparativo de Cenários Condicionais ({effectiveRegime})</h3>
            <span className="text-xs text-slate-400">{suiteResult.disclaimer}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-3 pr-4">Cenário</th>
                  <th className="py-3 px-3 text-right">Receita Líquida</th>
                  <th className="py-3 px-3 text-right">Margem Contrib.</th>
                  <th className="py-3 px-3 text-right">Resultado Oper.</th>
                  <th className="py-3 px-3 text-right">Lucro Líquido</th>
                  <th className="py-3 pl-3 text-right">Ponto Equilíbrio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {[
                  suiteResult.scenarios.original,
                  suiteResult.scenarios.optimistic,
                  suiteResult.scenarios.baseCase,
                  suiteResult.scenarios.adverse,
                ].map((sc: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-950/60">
                    <td className="py-3 pr-4 font-medium text-slate-200">{sc.scenarioLabel}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-200">
                      R$ {Number(sc.simulatedNetRevenue).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-200">
                      R$ {Number(sc.simulatedContributionMargin).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-200">
                      R$ {Number(sc.simulatedOperatingResult).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`py-3 px-3 text-right font-mono font-bold tabular-nums ${Number(sc.netProfitDiff) > 0 ? 'text-emerald-400' : Number(sc.netProfitDiff) < 0 ? 'text-rose-400' : 'text-white'}`}>
                      R$ {Number(sc.simulatedNetProfit).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 pl-3 text-right font-mono tabular-nums text-slate-300">
                      R$ {Number(sc.simulatedOperatingBreakEven).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
