import React, { useEffect, useState } from 'react';
import {
  Bookmark,
  Trash2,
  Plus,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Play,
  FileSearch,
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';

interface MemoryGovernanceViewProps {
  companyId: string;
  companyName: string;
  onSuccessMsg: (msg: string) => void;
  onErrorMsg: (msg: string) => void;
}

export const MemoryGovernanceView: React.FC<MemoryGovernanceViewProps> = ({
  companyId,
  companyName,
  onSuccessMsg,
  onErrorMsg,
}) => {
  const [memories, setMemories] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [evalRuns, setEvalRuns] = useState<any[]>([]);
  const [runningEval, setRunningEval] = useState(false);

  const [memType, setMemType] = useState('DECISION');
  const [memTitle, setMemTitle] = useState('');
  const [memSummary, setMemSummary] = useState('');

  const loadAll = async () => {
    if (!companyId) return;
    try {
      const [mRes, lRes, eRes] = await Promise.all([
        apiFetch(`/api/companies/${companyId}/memory`).then(r => r.json()),
        apiFetch(`/api/agent/logs?companyId=${encodeURIComponent(companyId)}`).then(r => r.json()),
        apiFetch('/api/evaluations').then(r => r.json()),
      ]);
      if (Array.isArray(mRes)) setMemories(mRes);
      if (Array.isArray(lRes)) setLogs(lRes);
      if (Array.isArray(eRes)) setEvalRuns(eRes);
    } catch {
      // Ignore silent load errors
    }
  };

  useEffect(() => {
    loadAll();
  }, [companyId]);

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memTitle.trim() || !memSummary.trim()) return;
    try {
      const res = await apiFetch(`/api/companies/${companyId}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoryType: memType,
          title: memTitle,
          summary: memSummary,
          createdBy: 'Gestor Financeiro',
        }),
      });
      if (!res.ok) throw new Error('Falha ao registrar memória operacional.');
      setMemTitle('');
      setMemSummary('');
      onSuccessMsg('Registro adicionado à Memória Operacional.');
      await loadAll();
    } catch (err: any) {
      onErrorMsg(err.message);
    }
  };

  const handleDeleteMemory = async (memoryId: string) => {
    try {
      const res = await apiFetch(`/api/companies/${companyId}/memory/${memoryId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Falha ao excluir registro.');
      onSuccessMsg('Registro removido da Memória Operacional.');
      await loadAll();
    } catch (err: any) {
      onErrorMsg(err.message);
    }
  };

  const handleRunEvaluation = async () => {
    setRunningEval(true);
    try {
      const res = await apiFetch('/api/evaluations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao executar avaliação.');
      onSuccessMsg(`Avaliação concluída: ${data.passedCases}/${data.totalCases} casos aprovados (${data.scorePct}%).`);
      await loadAll();
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setRunningEval(false);
    }
  };

  const latestEval = evalRuns[0];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Operational Memory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-400" />
            <span>Registrar Decisão / Memória</span>
          </h3>
          <p className="text-xs text-slate-400">
            Armazena somente informações estruturadas e autorizadas no contexto de {companyName}. Não substitui a DRE auditada.
          </p>
          <form onSubmit={handleCreateMemory} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Tipo</label>
              <select
                value={memType}
                onChange={e => setMemType(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              >
                <option value="DECISION">Decisão Gerencial</option>
                <option value="SCENARIO">Cenário Simulado</option>
                <option value="DIAGNOSTIC">Diagnóstico</option>
                <option value="INSIGHT">Insight Validado</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Título</label>
              <input
                type="text"
                value={memTitle}
                onChange={e => setMemTitle(e.target.value)}
                placeholder="Ex: Meta de redução de custos fixos"
                required
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Resumo Estruturado</label>
              <textarea
                rows={3}
                value={memSummary}
                onChange={e => setMemSummary(e.target.value)}
                placeholder="Descreva a decisão, premissa ou conclusão registrada..."
                required
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs"
            >
              Salvar na Memória Controlada
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-indigo-400" />
            <span>Memória Operacional da Empresa ({memories.length})</span>
          </h3>
          {memories.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">Nenhum registro na memória operacional desta empresa.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {memories.map(m => (
                <div key={m.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-white">{m.title}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-indigo-300 font-mono">{m.memoryType}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteMemory(m.id)}
                        className="p-1 text-slate-500 hover:text-rose-400 transition"
                        title="Excluir registro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-slate-300 leading-relaxed">{m.summary}</p>
                  <div className="text-[11px] text-slate-500 flex gap-2">
                    <span>{new Date(m.createdAt).toLocaleString('pt-BR')}</span>
                    {m.periodRef && <span>· Período: {m.periodRef}</span>}
                    {m.dataVersionRef && <span>· Versão: {m.dataVersionRef}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI Evaluation Benchmark */}
      <div className="p-6 lg:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
              <span>Avaliação Objetiva do Agente & Segurança (11 Casos)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Valida seleção de ferramentas, cálculos determinísticos, reconhecimento de dados ausentes, bloqueio de prompt injection e isolamento multi-empresa.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunEvaluation}
            disabled={runningEval}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{runningEval ? 'Executando Bateria...' : 'Executar Avaliação Agora'}</span>
          </button>
        </div>

        {latestEval ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-xs text-slate-300 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <span>Aprovação: <strong className="text-emerald-400 font-mono tabular-nums">{latestEval.passedCases}/{latestEval.totalCases} ({latestEval.scorePct}%)</strong></span>
              <span>Provedor: <strong className="text-indigo-300">{latestEval.provider}</strong> ({latestEval.modelUsed})</span>
              <span className="font-mono tabular-nums">Duração: {latestEval.durationMs} ms</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {latestEval.results?.map((r: any) => (
                <div key={r.id} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{r.category}</span>
                    <span className={`flex items-center gap-1 font-mono ${r.passed ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      <span>{r.passed ? 'PASS' : 'FAIL'}</span>
                    </span>
                  </div>
                  <div className="text-slate-400">{r.question}</div>
                  <div className="text-[11px] font-mono text-indigo-300">
                    Tools: {r.actualToolsCalled?.join(', ') || 'nenhuma'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 py-6 text-center">
            Clique em "Executar Avaliação Agora" para rodar os 11 testes objetivos do agente.
          </div>
        )}
      </div>

      {/* Audit Logs */}
      <div className="p-6 lg:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-indigo-400" />
          <span>Logs de Auditoria do Agente ({logs.length})</span>
        </h3>
        {logs.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhuma execução do agente registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-3">Execução</th>
                  <th className="py-2.5 px-3">Pergunta</th>
                  <th className="py-2.5 px-3">Ferramentas</th>
                  <th className="py-2.5 px-3">Provedor</th>
                  <th className="py-2.5 px-3 text-right">Duração</th>
                  <th className="py-2.5 pl-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {logs.slice(0, 15).map(l => (
                  <tr key={l.id} className="hover:bg-slate-950/60">
                    <td className="py-2.5 pr-3 font-mono text-slate-400 whitespace-nowrap">{l.executionId}</td>
                    <td className="py-2.5 px-3 text-slate-200 max-w-xs truncate">{l.question}</td>
                    <td className="py-2.5 px-3 font-mono text-indigo-300 max-w-xs truncate">
                      {Array.isArray(l.toolsCalled) ? l.toolsCalled.join(', ') : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap">{l.provider}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">{l.durationMs} ms</td>
                    <td className={`py-2.5 pl-3 text-right font-mono ${l.status === 'SUCCESS' ? 'text-emerald-400' : l.status === 'BLOCKED' ? 'text-amber-300' : 'text-rose-400'}`}>
                      {l.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
