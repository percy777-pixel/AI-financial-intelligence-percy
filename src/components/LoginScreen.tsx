import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import {
  apiFetch,
  setActiveCsrfToken,
  setActiveSessionToken,
} from '../utils/apiFetch';

export interface AuthUserInfo {
  id: string;
  fullName: string;
  name?: string;
  email: string;
  role: 'USER' | 'ADMIN' | string;
  emailVerified: boolean;
}

export interface AuthStatusPayload {
  authEnforced: boolean;
  authenticated: boolean;
  csrfToken: string | null;
  expiresAt?: string | null;
  rememberMe?: boolean;
  authProvider?: 'EMAIL_PASSWORD' | string | null;
  authModel?: string;
  isReadyForPublicMultiUser?: boolean;
  emailDeliveryConfigured?: boolean;
  hasPendingAdminMigration?: boolean;
  user?: AuthUserInfo | null;
  companyContextPolicy?: string;
  note?: string;
}

type AuthScreenMode = 'login' | 'register' | 'forgot' | 'admin_migrate';

interface LoginScreenProps {
  authStatus: AuthStatusPayload | null;
  onAuthenticated: () => Promise<void>;
  onReturnToDemo?: () => void;
}

export function LoginScreen({
  authStatus,
  onAuthenticated,
  onReturnToDemo,
}: LoginScreenProps) {
  const [mode, setMode] = useState<AuthScreenMode>('login');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Register form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState<'terms' | 'privacy' | null>(null);

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');

  // Admin migration state
  const [migAdminPassword, setMigAdminPassword] = useState('');
  const [migName, setMigName] = useState('');
  const [migEmail, setMigEmail] = useState('');
  const [migPassword, setMigPassword] = useState('');
  const [migPasswordConfirm, setMigPasswordConfirm] = useState('');

  const clearFeedback = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setInfoMsg(null);
  };

  const switchMode = (nextMode: AuthScreenMode) => {
    clearFeedback();
    setMode(nextMode);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!loginEmail.trim() || !loginPassword) {
      setErrorMsg('Informe seu e-mail e senha para entrar.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
          rememberMe,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.authenticated) {
        throw new Error(data.error || 'E-mail ou senha inválidos.');
      }

      if (data.sessionToken) {
        setActiveSessionToken(data.sessionToken);
      }
      setActiveCsrfToken(data.csrfToken || null);
      setLoginPassword('');
      setSuccessMsg('Autenticação concluída. Carregando seu ambiente...');
      await onAuthenticated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível entrar. Verifique suas credenciais.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (regName.trim().length < 2) {
      setErrorMsg('Informe seu nome completo.');
      return;
    }
    if (!regEmail.trim()) {
      setErrorMsg('Informe um endereço de e-mail válido.');
      return;
    }
    if (regPassword.length < 8 || !/[A-Za-z]/.test(regPassword) || !/[0-9]/.test(regPassword)) {
      setErrorMsg('A senha deve ter pelo menos 8 caracteres, incluindo letras e números.');
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      setErrorMsg('A confirmação de senha não confere.');
      return;
    }
    if (!acceptTerms) {
      setErrorMsg('É necessário aceitar os Termos de Uso e a Política de Privacidade para criar sua conta.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: regName.trim(),
          email: regEmail.trim(),
          password: regPassword,
          passwordConfirmation: regPasswordConfirm,
          acceptTerms,
          rememberMe: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.authenticated) {
        throw new Error(data.error || 'Não foi possível concluir o cadastro.');
      }

      if (data.sessionToken) {
        setActiveSessionToken(data.sessionToken);
      }
      setActiveCsrfToken(data.csrfToken || null);
      setRegPassword('');
      setRegPasswordConfirm('');
      setSuccessMsg('Conta criada com sucesso! Preparando sua área de trabalho isolada...');
      await onAuthenticated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao criar conta.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    if (!forgotEmail.trim()) {
      setErrorMsg('Informe seu e-mail cadastrado.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.code === 'EMAIL_SERVICE_NOT_CONFIGURED' || data?.code === 'EMAIL_FLOW_NOT_IMPLEMENTED') {
          setInfoMsg(
            data.error ||
              'O envio automático de e-mail para redefinição de senha ainda não está habilitado neste servidor.'
          );
          return;
        }
        throw new Error(data.error || 'Não foi possível solicitar a recuperação de senha.');
      }
      setSuccessMsg(data.message || 'Instruções enviadas.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao verificar recuperação de senha.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminMigrationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!migAdminPassword) {
      setErrorMsg('Informe a senha administrativa atual (APP_ADMIN_PASSWORD).');
      return;
    }
    if (migName.trim().length < 2 || !migEmail.trim()) {
      setErrorMsg('Informe nome completo e e-mail para a conta administrativa.');
      return;
    }
    if (migPassword.length < 8 || !/[A-Za-z]/.test(migPassword) || !/[0-9]/.test(migPassword)) {
      setErrorMsg('A nova senha deve ter pelo menos 8 caracteres com letras e números.');
      return;
    }
    if (migPassword !== migPasswordConfirm) {
      setErrorMsg('A confirmação da nova senha não confere.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/admin/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentAdminPassword: migAdminPassword,
          fullName: migName.trim(),
          email: migEmail.trim(),
          newPassword: migPassword,
          newPasswordConfirmation: migPasswordConfirm,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.authenticated) {
        throw new Error(data.error || 'Falha na migração administrativa.');
      }

      if (data.sessionToken) {
        setActiveSessionToken(data.sessionToken);
      }
      setActiveCsrfToken(data.csrfToken || null);
      setMigAdminPassword('');
      setMigPassword('');
      setMigPasswordConfirm('');
      setSuccessMsg(
        `Conta administrativa criada e vinculada com ${data.claimedCompaniesCount || 0} empresa(s) existente(s).`
      );
      await onAuthenticated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao migrar conta administrativa.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center px-4 py-8 sm:p-6 font-sans relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(79,70,229,0.16),_transparent_55%)]" />

      <div className="relative w-full max-w-md p-6 sm:p-8 rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl space-y-6 backdrop-blur">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3.5">
          <div className="p-3.5 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl shadow-lg shadow-indigo-500/25 ring-1 ring-white/10">
            <BrainCircuit className="w-7 h-7 text-white" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              AI Financial Intelligence
            </h1>
            <p className="text-sm text-slate-400">
              Inteligência financeira para decisões empresariais.
            </p>
          </div>
        </div>

        {/* Mode Switcher Tabs (Login / Criar conta) */}
        {(mode === 'login' || mode === 'register') && (
          <div
            role="tablist"
            aria-label="Opções de acesso"
            className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => switchMode('login')}
              className={`min-h-[44px] py-2 px-3 rounded-lg text-sm font-semibold transition cursor-pointer ${
                mode === 'login'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => switchMode('register')}
              className={`min-h-[44px] py-2 px-3 rounded-lg text-sm font-semibold transition cursor-pointer ${
                mode === 'register'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Criar conta
            </button>
          </div>
        )}

        {/* Environment without SESSION_SECRET warning */}
        {authStatus && !authStatus.authEnforced && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <p className="leading-relaxed">
              Este ambiente está operando sem <code className="font-mono">SESSION_SECRET</code> definido. Configure uma chave de sessão segura para ativar cadastro e login obrigatórios.
            </p>
          </div>
        )}

        {/* Feedback Banners */}
        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
            <p className="leading-relaxed">{errorMsg}</p>
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
            <p className="leading-relaxed">{successMsg}</p>
          </div>
        )}

        {infoMsg && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5"
          >
            <Info className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <p className="leading-relaxed">{infoMsg}</p>
          </div>
        )}

        {/* LOGIN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  required
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="block text-xs font-medium text-slate-300">
                  Senha
                </label>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                >
                  Esqueci minha senha
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="login-password"
                  type={showLoginPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Digite sua senha"
                  required
                  className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(prev => !prev)}
                  aria-label={showLoginPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1.5 p-2 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
              />
              <span>Manter sessão conectada por até 7 dias neste dispositivo</span>
            </label>

            <button
              type="submit"
              disabled={submitting || (authStatus ? !authStatus.authEnforced : false)}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <span>Entrar</span>
              )}
            </button>
          </form>
        )}

        {/* REGISTRATION FORM */}
        {mode === 'register' && (
          <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="reg-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                Nome completo
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="reg-name"
                  type="text"
                  autoComplete="name"
                  value={regName}
                  onChange={e => setRegName(e.target.value)}
                  placeholder="Seu nome completo"
                  required
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                E-mail corporativo ou pessoal
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="reg-email"
                  type="email"
                  autoComplete="email"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  placeholder="voce@empresa.com.br"
                  required
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="reg-password"
                  type={showRegPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={regPassword}
                  onChange={e => setRegPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres (letras e números)"
                  required
                  className="w-full min-h-[44px] pl-10 pr-11 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowRegPassword(prev => !prev)}
                  aria-label={showRegPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1.5 p-2 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reg-password-confirm" className="block text-xs font-medium text-slate-300 mb-1.5">
                Confirmar senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                <input
                  id="reg-password-confirm"
                  type={showRegPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={regPasswordConfirm}
                  onChange={e => setRegPasswordConfirm(e.target.value)}
                  placeholder="Repita a senha"
                  required
                  className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-start gap-2.5 text-xs text-slate-300 pt-1">
              <input
                id="accept-terms"
                type="checkbox"
                checked={acceptTerms}
                onChange={e => setAcceptTerms(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded border-slate-700 bg-slate-950 accent-indigo-500 shrink-0"
              />
              <label htmlFor="accept-terms" className="leading-relaxed cursor-pointer">
                Li e aceito os{' '}
                <button
                  type="button"
                  onClick={() => setTermsModalOpen('terms')}
                  className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                >
                  Termos de Uso
                </button>{' '}
                e a{' '}
                <button
                  type="button"
                  onClick={() => setTermsModalOpen('privacy')}
                  className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
                >
                  Política de Privacidade
                </button>
                .
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || (authStatus ? !authStatus.authEnforced : false)}
              className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Criando conta...</span>
                </>
              ) : (
                <span>Criar minha conta</span>
              )}
            </button>
          </form>
        )}

        {/* FORGOT PASSWORD VIEW */}
        {mode === 'forgot' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para o login</span>
            </button>

            <div className="space-y-1">
              <h2 className="text-base font-bold text-white">Recuperação de senha</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                {authStatus?.emailDeliveryConfigured
                  ? 'Informe o e-mail da sua conta para receber um link único e temporário de redefinição.'
                  : 'Verifique a disponibilidade do serviço de recuperação por e-mail neste ambiente.'}
              </p>
            </div>

            {!authStatus?.emailDeliveryConfigured && (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-amber-300">Serviço de e-mail não configurado</div>
                  <p className="text-slate-400 leading-relaxed">
                    Nenhum provedor de disparo de e-mails foi habilitado ainda no servidor, portanto o envio automático de links de redefinição não está ativo. Caso precise redefinir seu acesso, contate o administrador da plataforma.
                  </p>
                </div>
              </div>
            )}

            <form onSubmit={handleForgotSubmit} className="space-y-3.5">
              <div>
                <label htmlFor="forgot-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                  E-mail cadastrado
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
                  <input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    placeholder="voce@empresa.com.br"
                    required
                    className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm border border-slate-700 transition cursor-pointer flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Verificar envio de recuperação</span>
              </button>
            </form>
          </div>
        )}

        {/* ONE-TIME ADMIN MIGRATION VIEW */}
        {mode === 'admin_migrate' && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Voltar para o login</span>
            </button>

            <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-xs text-slate-300 flex items-start gap-2.5">
              <KeyRound className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-indigo-300">Migração da conta administrativa</div>
                <p className="text-slate-300/90 leading-relaxed">
                  Converta sua senha administrativa legada em uma conta individual de administrador com e-mail e senha próprios, preservando e vinculando todas as empresas existentes.
                </p>
              </div>
            </div>

            <form onSubmit={handleAdminMigrationSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Senha administrativa atual
                </label>
                <input
                  type="password"
                  value={migAdminPassword}
                  onChange={e => setMigAdminPassword(e.target.value)}
                  placeholder="Senha administrativa atual"
                  required
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nome completo do administrador
                </label>
                <input
                  type="text"
                  value={migName}
                  onChange={e => setMigName(e.target.value)}
                  placeholder="Nome completo"
                  required
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  E-mail do administrador
                </label>
                <input
                  type="email"
                  value={migEmail}
                  onChange={e => setMigEmail(e.target.value)}
                  placeholder="admin@suaempresa.com.br"
                  required
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nova senha pessoal
                </label>
                <input
                  type="password"
                  value={migPassword}
                  onChange={e => setMigPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres (letras e números)"
                  required
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Confirmar nova senha
                </label>
                <input
                  type="password"
                  value={migPasswordConfirm}
                  onChange={e => setMigPasswordConfirm(e.target.value)}
                  placeholder="Repita a nova senha"
                  required
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold text-sm transition cursor-pointer flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>Concluir migração administrativa</span>
              </button>
            </form>
          </div>
        )}

        {/* Security Assurance Footer */}
        <div className="pt-3 border-t border-slate-800/80 space-y-2.5 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Dados e empresas isolados por conta · Sessão criptografada</span>
          </div>

          {authStatus?.hasPendingAdminMigration && mode !== 'admin_migrate' && (
            <div>
              <button
                type="button"
                onClick={() => switchMode('admin_migrate')}
                className="text-xs text-slate-400 hover:text-indigo-300 underline transition cursor-pointer"
              >
                Migrar conta administrativa legada
              </button>
            </div>
          )}

          {!authStatus?.authEnforced && onReturnToDemo && (
            <div>
              <button
                type="button"
                onClick={onReturnToDemo}
                className="text-xs text-slate-400 hover:text-indigo-300 transition cursor-pointer"
              >
                Voltar para o painel de demonstração
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Terms of Use & Privacy Policy Modal */}
      {termsModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={termsModalOpen === 'terms' ? 'Termos de Uso' : 'Política de Privacidade'}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-white font-bold text-base">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>{termsModalOpen === 'terms' ? 'Termos de Uso' : 'Política de Privacidade'}</span>
              </div>
              <button
                type="button"
                onClick={() => setTermsModalOpen(null)}
                aria-label="Fechar"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto text-xs text-slate-300 space-y-3 pr-1 leading-relaxed">
              {termsModalOpen === 'terms' ? (
                <>
                  <p>
                    Ao criar uma conta no <strong>AI Financial Intelligence</strong>, você recebe acesso individual e exclusivo às empresas, planilhas, indicadores, relatórios e simulações financeiras cadastradas sob a sua conta.
                  </p>
                  <p>
                    Você é responsável pela veracidade dos dados financeiros inseridos, pela guarda das suas credenciais de acesso e pela validação contábil e tributária final antes de tomar decisões empresariais ou fiscais.
                  </p>
                  <p>
                    Não tente acessar identificadores ou registros pertencentes a outras contas. Tentativas abusivas de autenticação estão sujeitas a bloqueio temporário por segurança.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Coletamos apenas seu nome completo, endereço de e-mail normalizado e hash criptográfico irreversível da sua senha para autenticação e isolamento dos seus dados empresariais.
                  </p>
                  <p>
                    Suas senhas nunca são armazenadas ou exibidas em texto aberto. As sessões autenticadas utilizam cookies seguros <code className="font-mono">HttpOnly</code> com expiração controlada e proteção CSRF.
                  </p>
                  <p>
                    Todas as empresas, períodos financeiros, contratos de dívida, execuções do agente e memórias operacionais criadas por você permanecem isoladas e vinculadas estritamente à sua conta.
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setAcceptTerms(true);
                  setTermsModalOpen(null);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                Aceitar e fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
