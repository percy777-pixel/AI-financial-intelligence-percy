import React, { useState } from 'react';
import {
  BrainCircuit,
  Send,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Database,
  Clock,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';

interface AgentStep {
  type: 'interpreting' | 'tool_start' | 'tool_result' | 'synthesizing' | 'completed' | 'error';
  timestamp: string;
  message: string;
  toolName?: string;
  args?: any;
  result?: any;
}

interface AgentIntelligenceCenterProps {
  companyId: string;
  companyName: string;
  taxRegime?: string;
  onSuccessMsg: (msg: string) => void;
  onErrorMsg: (msg: string) => void;
}

const SUGGESTED_QUESTIONS = [
  'Como um aumento da Selic de 13% para 15% pode afetar minha empresa?',
  'Minhas vendas caíram 10%. Qual o impacto no lucro e o que pode estar acontecendo?',
  'Qual é a saúde financeira atual e os principais riscos do meu negócio?',
  'Compare os dois últimos períodos e explique a evolução da margem líquida.',
  'Quais dados estão faltando para uma análise completa de capital de giro?',
  'Gere um relatório executivo completo da empresa.',
];

export const AgentIntelligenceCenter: React.FC<AgentIntelligenceCenterProps> = ({
  companyId,
  companyName,
  taxRegime,
  onSuccessMsg,
  onErrorMsg,
}) => {
  const [question, setQuestion] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<any>(null);
  const [expandedToolIdx, setExpandedToolIdx] = useState<number | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);

  const handleRunAgent = async (promptText?: string) => {
    const q = (promptText ?? question).trim();
    if (!q) return;
    if (!companyId) {
      onErrorMsg('Selecione uma empresa antes de consultar o agente.');
      return;
    }

    if (promptText) setQuestion(promptText);
    setRunning(true);
    setSteps([]);
    setResult(null);
    setExpandedToolIdx(null);

    try {
      const response = await apiFetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, question: q }),
      });

      if (!response.ok || !response.body) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || 'Falha na comunicação com o agente.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const lines = block.split('\n');
          let evName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) evName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr += line.slice(6);
          }
          if (!dataStr) continue;
          const payload = JSON.parse(dataStr);
          if (evName === 'step') {
            setSteps(prev => [...prev, payload]);
          } else if (evName === 'result') {
            setResult(payload);
          } else if (evName === 'error') {
            onErrorMsg(payload.error || 'Erro durante execução do agente.');
          }
        }
      }
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleSaveToMemory = async () => {
    if (!result) return;
    setSavingMemory(true);
    try {
      const res = await apiFetch(`/api/companies/${companyId}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoryType: 'INSIGHT',
          title: result.question.slice(0, 90),
          summary: result.answer.slice(0, 1200),
          structuredData: {
            executionId: result.executionId,
            toolsCalled: result.toolsCalled?.map((t: any) => t.toolName),
            provider: result.provider,
          },
          periodRef: result.dataVersionsUsed?.[0] || 'Atual',
          dataVersionRef: result.dataVersionsUsed?.join(', '),
          createdBy: 'Agente IA',
        }),
      });
      if (!res.ok) throw new Error('Falha ao salvar na memória operacional.');
      onSuccessMsg('Análise registrada na Memória Operacional da empresa.');
    } catch (err: any) {
      onErrorMsg(err.message);
    } finally {
      setSavingMemory(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="p-6 lg:p-8 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2.5">
              <BrainCircuit className="w-6 h-6 text-indigo-400" />
              <span>Centro de Inteligência — Agente Financeiro</span>
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Empresa ativa: <span className="text-slate-200 font-medium">{companyName}</span>
              {taxRegime ? ` · ${taxRegime}` : ''} · Ferramentas determinísticas reais + Gemini Function Calling
            </p>
          </div>
          {result && (
            <button
              onClick={handleSaveToMemory}
              disabled={savingMemory}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-2 transition whitespace-nowrap shrink-0"
            >
              <BookmarkPlus className="w-4 h-4 text-indigo-400" />
              <span>{savingMemory ? 'Salvando...' : 'Salvar na Memória'}</span>
            </button>
          )}
        </div>

        {/* Suggested prompts */}
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q, i) => (
            <button
              key={i}
              type="button"
              disabled={running}
              onClick={() => handleRunAgent(q)}
              className="text-left text-xs px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 text-slate-300 transition disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Prompt Input */}
        <form
          onSubmit={e => {
            e.preventDefault();
            handleRunAgent();
          }}
          className="flex flex-col sm:flex-row gap-3"
        >
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Faça uma pergunta empresarial (ex: Como uma Selic de 15% afeta minha dívida?)"
            className="flex-1 px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
            disabled={running}
          />
          <button
            type="submit"
            disabled={running || !question.trim()}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm flex items-center justify-center gap-2 transition whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            <span>{running ? 'Processando...' : 'Consultar Agente'}</span>
          </button>
        </form>
      </div>

      {/* Real-time Process Execution & Structured Answer Grid */}
      {(steps.length > 0 || result) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Real Execution Trace */}
          <div className="lg:col-span-5 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Wrench className="w-4 h-4 text-indigo-400" />
                <span>Execução Real das Ferramentas</span>
              </h3>
              {result && (
                <span className="text-xs font-mono text-slate-400 tabular-nums">
                  {result.durationMs} ms · {result.toolsCalled?.length || 0} tools
                </span>
              )}
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                      {step.type === 'error' ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      ) : step.type === 'completed' || step.type === 'tool_result' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      )}
                      <span>{step.message}</span>
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {new Date(step.timestamp).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Inspectable Tool Payloads */}
            {result?.toolsCalled?.length > 0 && (
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-400">
                  Dados Auditáveis Retornados ({result.toolsCalled.length})
                </div>
                {result.toolsCalled.map((tool: any, idx: number) => {
                  const isOpen = expandedToolIdx === idx;
                  return (
                    <div key={idx} className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedToolIdx(isOpen ? null : idx)}
                        className="w-full px-3 py-2.5 flex items-center justify-between text-xs hover:bg-slate-900 transition"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="font-mono text-indigo-300 font-medium">{tool.toolName}</span>
                          <span className="text-slate-500 font-mono tabular-nums">{tool.durationMs}ms</span>
                        </div>
                        {isOpen ? (
                          <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pt-1 border-t border-slate-800 space-y-2 text-[11px]">
                          <div className="text-slate-400">
                            Fonte: <span className="text-slate-200">{tool.source}</span>
                          </div>
                          {tool.dataVersions?.length > 0 && (
                            <div className="text-slate-400">
                              Versões: <span className="font-mono text-slate-300">{tool.dataVersions.join(', ')}</span>
                            </div>
                          )}
                          <pre className="p-2.5 rounded-lg bg-slate-900 text-slate-300 overflow-x-auto max-h-56 font-mono">
                            {JSON.stringify(tool.dataPreview, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Synthesis & Provenance */}
          <div className="lg:col-span-7 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
            {result ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-800 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    {result.status === 'BLOCKED' && <ShieldAlert className="w-4 h-4 text-rose-400" />}
                    <span>Execução: <strong className="font-mono text-slate-200">{result.executionId}</strong></span>
                    <span aria-hidden="true">·</span>
                    <span>Provedor: <strong className="text-indigo-300">{result.provider}</strong> ({result.modelUsed})</span>
                  </div>
                  {result.tokenUsage && (
                    <span className="font-mono tabular-nums">
                      Tokens: {result.tokenUsage.totalTokens}
                    </span>
                  )}
                </div>

                {result.fallbackReason && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{result.fallbackReason}</span>
                  </div>
                )}

                <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-slate-200 leading-relaxed">
                  {result.answer}
                </div>

                {/* Sources & Data Versions */}
                <div className="pt-4 border-t border-slate-800 space-y-2 text-xs">
                  <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Fontes e Versões Utilizadas</span>
                  </div>
                  <div className="text-slate-400 space-y-1">
                    {result.sources?.map((s: string, idx: number) => (
                      <div key={idx}>• {s}</div>
                    ))}
                    {result.dataVersionsUsed?.length > 0 && (
                      <div className="font-mono text-slate-400 pt-1">
                        Referências: {result.dataVersionsUsed.join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-slate-400 text-sm">
                Executando etapas reais do agente no servidor...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
