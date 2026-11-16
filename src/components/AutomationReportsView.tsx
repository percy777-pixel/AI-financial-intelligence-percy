import React, { useEffect, useState } from 'react';
import {
  Workflow,
  FileText,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Webhook,
  BarChart2,
  Send,
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';

interface AutomationReportsViewProps {
  companyId: string;
  companyName: string;
  onSuccessMsg: (msg: string) => void;
  onErrorMsg: (msg: string) => void;
  onDataUpdated: () => void;
}

export const AutomationReportsView: React.FC<AutomationReportsViewProps> = ({
  companyId,
  companyName,
  onSuccessMsg,
  onErrorMsg,
  onDataUpdated,
}) => {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(11);
  const [dispatchWebhookOnRun, setDispatchWebhookOnRun] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [activeReport, setActiveReport] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [baselines, setBaselines] = useState<any[]>([]);
  const [webhookStatus, setWebhookStatus] = useState<any>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // Manual baseline recording form
  const [manualSpreadsheetMin, setManualSpreadsheetMin] = useState<number>(45);
  const [manualDiagnosticMin, setManualDiagnosticMin] = useState<number>(60);
  const [manualReportMin, setManualReportMin] = useState<number>(90);

  const loadAutomationData = async () => {
    if (!companyId) return;
    try {
      const [telRes, whRes] = await Promise.all([
        apiFetch(`/api/companies/${companyId}/telemetry`, {
          headers: { 'X-Company-Context': companyId },
        }).then(r => r.json()),
        apiFetch('/api/automation/webhooks/status').then(r => r.json()),
      ]);
      setTelemetry(telRes.telemetry);
      setBaselines(telRes.baselines || []);
      setWebhookStatus(whRes);
    } catch {
      // Ignore silent load errors
    }
  };

  useEffect(() => {
    setPipelineResult(null);
    setActiveReport(null);
    loadAutomationData();
  }, [companyId]);

  const handleDownloadSampleCsv = () => {
    const csv = [
      'Receita Bruta,Deduções,CMV,Despesas Variáveis,Despesas Fixas,Depreciação,Receitas Financeiras,Despesas Financeiras,Caixa,Contas a Receber,Estoque,Contas a Pagar,Ativo Circulante,Passivo Circulante,Ativo Total,Dívida Total,Patrimônio Líquido',
      '195000,18525,83850,15600,52500,2500,650,4700,32000,44000,112000,48000,188000,132000,348000,142000,206000',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_varejo_vestuario.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRunAutomatedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setRunningPipeline(true);
    setPipelineResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('year', String(year));
    formData.append('month', String(month));
    formData.append('dispatchWebhook', String(dispatchWebhookOnRun));

    try {
      const res = await apiFetch(`/api/companies/${companyId}/automation/import-to-report`, {
        method: 'POST',
        headers: { 'X-Company-Context': companyId },
        body: formData,
      });
      const data = await res.json();
      setPipelineResult(data);
      if (data.needsCorrection) {
        onErrorMsg('Pipeline interrompido na validação: corrija os erros apontados antes de salvar.');
      } else {
        setActiveReport(data.report);
        onSuccessMsg('Automação concluída: planilha validada, período versionado e relatório gerado.');
        onDataUpdated();
      }
      await loadAutomationData();
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setRunningPipeline(false);
    }
  };

  const handleTestWebhookNow = async () => {
    if (!companyId) return;
    setTestingWebhook(true);
    try {
      const res = await apiFetch('/api/automation/webhooks/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (data.webhookStatus) {
        setWebhookStatus(data.webhookStatus);
      }
      if (res.ok && data.dispatched) {
        onSuccessMsg(`Webhook n8n entregue com sucesso (${data.status}, HTTP ${data.httpStatus}) usando header X-N8N-Webhook-Secret.`);
      } else {
        onErrorMsg(data.reason || data.error || `Falha no envio do webhook (${data.status}).`);
      }
      await loadAutomationData();
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleGenerateExecutiveReport = async () => {
    setGeneratingReport(true);
    try {
      const res = await apiFetch(`/api/companies/${companyId}/reports/executive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao gerar relatório.');
      setActiveReport(data);
      onSuccessMsg('Relatório Executivo gerado e registrado.');
      await loadAutomationData();
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleExportReportMarkdown = () => {
    if (!activeReport?.markdown) return;
    const blob = new Blob([activeReport.markdown], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_executivo_${activeReport.periodRef?.replace('/', '-') || 'atual'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveBaseline = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch(`/api/companies/${companyId}/baseline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Company-Context': companyId,
        },
        body: JSON.stringify({
          manualSpreadsheetMinutes: manualSpreadsheetMin,
          manualDiagnosticMinutes: manualDiagnosticMin,
          manualReportMinutes: manualReportMin,
          notes: 'Medição inicial informada pelo usuário para comparativo antes/depois.',
        }),
      });
      if (!res.ok) throw new Error('Falha ao salvar medição base.');
      onSuccessMsg('Medição manual inicial registrada para comparação honesta de tempo.');
      await loadAutomationData();
    } catch (err: any) {
      onErrorMsg(err.message);
    }
  };

  const latestBaseline = baselines[0];
  const totalManualMin = latestBaseline
    ? latestBaseline.manualSpreadsheetMinutes +
      latestBaseline.manualDiagnosticMinutes +
      latestBaseline.manualReportMinutes
    : null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Automated Pipeline Card */}
      <div className="p-6 lg:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Workflow className="w-6 h-6 text-indigo-400" />
              <span>Automação Ponta a Ponta & Relatórios</span>
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Executa automaticamente: Leitura CSV/XLSX → Mapeamento → Validação estrita → Cálculo DRE → Versionamento → Relatório Executivo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadSampleCsv}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Baixar CSV Modelo</span>
            </button>
            <button
              type="button"
              onClick={handleGenerateExecutiveReport}
              disabled={generatingReport}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{generatingReport ? 'Gerando...' : 'Gerar Relatório do Período Atual'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Empresa Alvo</label>
            <div className="px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 truncate">
              {companyName}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Ano</label>
            <input
              type="number"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Mês</label>
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
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

        <div className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            id="opt-in-webhook"
            checked={dispatchWebhookOnRun}
            onChange={e => setDispatchWebhookOnRun(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 accent-indigo-500"
          />
          <label htmlFor="opt-in-webhook" className="cursor-pointer">
            Disparar evento HTTP POST para o Webhook n8n (`X-N8N-Webhook-Secret`) ao concluir o relatório (requer autorização explícita)
          </label>
        </div>

        <div className="border-2 border-dashed border-slate-800 rounded-2xl p-6 text-center bg-slate-950/60 hover:border-indigo-500/40 transition">
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleRunAutomatedFile}
            disabled={runningPipeline}
            className="hidden"
            id="auto-pipeline-file"
          />
          <label htmlFor="auto-pipeline-file" className="cursor-pointer flex flex-col items-center">
            <Upload className="w-8 h-8 text-indigo-400 mb-2" />
            <span className="text-white font-medium text-sm">
              {runningPipeline ? 'Executando pipeline automatizado...' : 'Enviar CSV ou XLSX para Pipeline Completo'}
            </span>
            <span className="text-xs text-slate-500 mt-1">
              Nenhuma importação é confirmada silenciosamente sem passar pela etapa de validação.
            </span>
          </label>
        </div>

        {/* Pipeline Execution Steps */}
        {pipelineResult?.run && (
          <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-white">
                Execução {pipelineResult.run.id} · Status: {pipelineResult.run.status}
              </span>
              <span className="font-mono text-slate-400 tabular-nums">
                Duração total: {pipelineResult.run.durationMs} ms
              </span>
            </div>
            <div className="space-y-2">
              {pipelineResult.run.steps?.map((st: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-900">
                  <span className="flex items-center gap-2 text-slate-200">
                    {st.status === 'COMPLETED' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : st.status === 'FAILED' ? (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                    <span>{st.step}</span>
                  </span>
                  <span className="text-slate-400 truncate max-w-md">{st.detail || st.status}</span>
                </div>
              ))}
            </div>
            {pipelineResult.validation?.errors?.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                <div className="font-bold">Correções Necessárias Antes de Persistir:</div>
                {pipelineResult.validation.errors.map((err: string, i: number) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Executive Report Viewer */}
      {activeReport && (
        <div className="p-6 lg:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-lg font-bold text-white">
                Relatório Executivo ({activeReport.periodRef} · {activeReport.dataVersionRef})
              </h3>
              <p className="text-xs text-slate-400">
                Gerado em {new Date(activeReport.generatedAt).toLocaleString('pt-BR')} · Provedor: {activeReport.provider}
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportReportMarkdown}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Exportar Markdown (.md)</span>
            </button>
          </div>
          <pre className="p-5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed max-h-[540px] overflow-y-auto">
            {activeReport.markdown}
          </pre>
        </div>
      )}

      {/* Business Value Telemetry & Honest Baseline Comparison + n8n Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-400" />
            <span>Telemetria Real & Comparativo de Valor</span>
          </h3>
          {telemetry && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-slate-400">Tempo Médio Automação</div>
                <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                  {telemetry.avgExecutionDurationMs !== null ? `${telemetry.avgExecutionDurationMs} ms` : 'Sem execuções'}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-slate-400">Relatórios Gerados</div>
                <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                  {telemetry.reportsGeneratedCount}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-slate-400">Inconsistências Detectadas</div>
                <div className="text-lg font-mono font-bold text-amber-300 mt-1 tabular-nums">
                  {telemetry.totalInconsistenciesDetected}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <div className="text-slate-400">Etapas Automatizadas</div>
                <div className="text-lg font-mono font-bold text-emerald-400 mt-1 tabular-nums">
                  {telemetry.totalStepsAutomated}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSaveBaseline} className="pt-3 border-t border-slate-800 space-y-3 text-xs">
            <div className="font-semibold text-slate-300">
              Registrar Medição Inicial Manual (para comparação real antes/depois)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-slate-400 block mb-1">Planilha (min)</label>
                <input
                  type="number"
                  value={manualSpreadsheetMin}
                  onChange={e => setManualSpreadsheetMin(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Diagnóstico (min)</label>
                <input
                  type="number"
                  value={manualDiagnosticMin}
                  onChange={e => setManualDiagnosticMin(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                />
              </div>
              <div>
                <label className="text-slate-400 block mb-1">Relatório (min)</label>
                <input
                  type="number"
                  value={manualReportMin}
                  onChange={e => setManualReportMin(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white font-mono"
                />
              </div>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium"
            >
              Salvar Baseline Manual
            </button>
            {totalManualMin !== null && telemetry?.avgExecutionDurationMs !== null && (
              <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/30 text-indigo-200">
                Baseline registrado: <strong>{totalManualMin} min</strong> manuais vs{' '}
                <strong>{(telemetry.avgExecutionDurationMs / 1000).toFixed(2)}s</strong> medidos na execução automatizada.
              </div>
            )}
          </form>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Webhook className="w-5 h-5 text-indigo-400" />
              <span>Integração Externa (n8n / Webhooks)</span>
            </h3>
            <button
              type="button"
              onClick={handleTestWebhookNow}
              disabled={testingWebhook || !webhookStatus?.configured}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-medium flex items-center gap-1.5 transition"
              title="Executar disparo real de teste para o endpoint n8n configurado"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testingWebhook ? 'Testando...' : 'Testar Webhook n8n'}</span>
            </button>
          </div>
          {webhookStatus && (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Endpoint (`N8N_WEBHOOK_URL`):</span>
                <span className={webhookStatus.configured ? 'text-emerald-400 font-semibold' : 'text-amber-300 font-semibold'}>
                  {webhookStatus.configured ? `CONFIGURADO (${webhookStatus.endpointMasked})` : 'NÃO CONFIGURADO'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Header Auth (`X-N8N-Webhook-Secret`):</span>
                <span className={webhookStatus.secretConfigured ? 'text-emerald-400 font-semibold' : 'text-amber-300'}>
                  {webhookStatus.secretConfigured ? 'SEGREDO CONFIGURADO' : 'AUSENTE'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Validação em Execução Real:</span>
                <span className={webhookStatus.tested ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>
                  {webhookStatus.tested ? `TESTADO (${webhookStatus.lastTestStatus})` : 'Não testado em execução real'}
                </span>
              </div>
              {webhookStatus.diagnostics && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-2 border-t border-slate-900 text-[11px]">
                  {[
                    { label: '1. Configurado', val: webhookStatus.diagnostics.webhookConfigured },
                    { label: '2. Acessível', val: webhookStatus.diagnostics.webhookReachable },
                    { label: '3. Auth Aprovada', val: webhookStatus.diagnostics.authApproved },
                    { label: '4. Executado', val: webhookStatus.diagnostics.executionPerformed },
                    { label: '5. Sucesso', val: webhookStatus.diagnostics.executionSucceeded },
                  ].map((d, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-slate-900 border border-slate-800/80 text-center">
                      <div className="text-slate-400 truncate">{d.label}</div>
                      <div
                        className={`font-mono font-bold mt-0.5 ${
                          d.val === true ? 'text-emerald-400' : d.val === false ? 'text-rose-400' : 'text-slate-500'
                        }`}
                      >
                        {d.val === true ? 'SIM' : d.val === false ? 'NÃO' : 'PENDENTE'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-slate-400 leading-relaxed pt-1">{webhookStatus.note}</p>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Execuções Recentes de Automação</div>
            {telemetry?.recentRuns?.length > 0 ? (
              telemetry.recentRuns.slice(0, 4).map((r: any) => (
                <div key={r.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex justify-between items-center text-xs">
                  <div>
                    <div className="font-medium text-slate-200">{r.workflowType}</div>
                    <div className="text-slate-500">{new Date(r.startedAt).toLocaleString('pt-BR')}</div>
                  </div>
                  <div className="text-right font-mono">
                    <div className={r.status === 'COMPLETED' ? 'text-emerald-400' : 'text-amber-300'}>{r.status}</div>
                    <div className="text-slate-500 tabular-nums">{r.durationMs ? `${r.durationMs} ms` : '-'}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">Nenhuma execução automatizada registrada ainda.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
