/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useState, useEffect, useCallback, useRef } from 'react';
import { 
  Plus, Trash2, Save, Download, Upload, Search, FileSpreadsheet, 
  AlertCircle, Check, BarChart3, PieChart as PieChartIcon, 
  LayoutDashboard, X, Share2, ExternalLink, Copy, Pencil, LogIn, LogOut, User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { 
  db, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, User
} from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Error Boundary Component
class ErrorBoundary extends Component<any, any> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    (this as any).state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if ((this as any).state.hasError) {
      let errorMessage = "Ocorreu um erro inesperado. Por favor, tente recarregar a página.";
      let isFirebaseError = false;

      try {
        const errorStr = String((this as any).state.error);
        if (errorStr.includes('operationType')) {
          const errData = JSON.parse(errorStr.replace('Error: ', ''));
          if (errData.error.includes('permission-denied')) {
            errorMessage = "Você não tem permissão para realizar esta operação ou acessar estes dados.";
            isFirebaseError = true;
          }
        }
      } catch (e) {
        // Fallback to default message
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Ops! Algo deu errado.</h2>
            <p className="text-slate-600 mb-6 text-sm">
              {errorMessage}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Recarregar Página
            </button>
            {process.env.NODE_ENV === 'development' && (
              <pre className="mt-4 p-4 bg-slate-100 rounded text-left text-xs overflow-auto max-h-40">
                {String((this as any).state.error)}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}



interface RowData {
  id: string;
  uid: string;
  neNumber: string;
  type: 'Consumo' | 'Serviço' | 'Extra' | '';
  obDate: string;
  obValidityDays: string;
  value: string;
  reDate: string;
  prestacaoDate: string;
  vencimentoDate: string;
  lancadoPlanilha: string;
  externalLink: string;
  isConfirmed: boolean;
}

const DEFAULT_ROW = (): Omit<RowData, 'uid'> => ({
  id: crypto.randomUUID(),
  neNumber: '',
  type: '',
  obDate: '',
  obValidityDays: '30',
  value: '',
  reDate: '',
  prestacaoDate: '',
  vencimentoDate: '',
  lancadoPlanilha: '',
  externalLink: '',
  isConfirmed: false,
});

export default function App() {
  const [rows, setRows] = useState<RowData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [isDashboardOnly, setIsDashboardOnly] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [editingRow, setEditingRow] = useState<RowData | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Check if we are in "Dashboard Only" mode via URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'dashboard') {
      setIsDashboardOnly(true);
      setShowDashboard(true);
    }
  }, []);

  // Firestore listener
  useEffect(() => {
    if (!isAuthReady || !user) {
      if (isAuthReady && !user) {
        setRows([]);
        setIsLoaded(true);
      }
      return;
    }

    const q = query(
      collection(db, 'rows'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedRows = snapshot.docs.map(doc => doc.data() as RowData);
      setRows(fetchedRows);
      setIsLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'rows');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const addRow = async () => {
    if (!user) return;
    const newRow = { ...DEFAULT_ROW(), uid: user.uid };
    try {
      await setDoc(doc(db, 'rows', newRow.id), newRow);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `rows/${newRow.id}`);
    }
  };

  const calculateVencimento = (obDate: string, validityDays: string) => {
    if (!obDate || !validityDays) return '';
    const date = new Date(obDate);
    // Add 1 day to account for timezone offset if needed, but usually YYYY-MM-DD is UTC-ish in Date constructor
    // Actually, Date constructor with YYYY-MM-DD treats it as UTC.
    // Let's use a more robust way to avoid timezone shifts.
    const [year, month, day] = obDate.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const days = parseInt(validityDays);
    if (isNaN(days)) return '';
    d.setDate(d.getDate() + days);
    
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayStr = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dayStr}`;
  };

  const updateRow = async (id: string, field: keyof RowData, value: any) => {
    if (!user) return;
    const row = rows.find(r => r.id === id);
    if (!row) return;

    const updatedData: any = { [field]: value };
    if (field === 'obDate' || field === 'obValidityDays') {
      const obDate = field === 'obDate' ? value : row.obDate;
      const obValidityDays = field === 'obValidityDays' ? value : row.obValidityDays;
      updatedData.vencimentoDate = calculateVencimento(obDate, obValidityDays);
    }

    try {
      await updateDoc(doc(db, 'rows', id), updatedData);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rows/${id}`);
    }
  };

  const toggleConfirm = (id: string) => {
    const row = rows.find(r => r.id === id);
    if (row) {
      updateRow(id, 'isConfirmed', !row.isConfirmed);
    }
  };

  const deleteRow = async (id: string) => {
    if (!user) return;
    if (window.confirm('Tem certeza que deseja excluir esta linha?')) {
      try {
        await deleteDoc(doc(db, 'rows', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `rows/${id}`);
      }
    }
  };

  const duplicateRow = async (id: string) => {
    if (!user) return;
    const rowToDuplicate = rows.find(r => r.id === id);
    if (rowToDuplicate) {
      const newRow = { 
        ...rowToDuplicate, 
        id: crypto.randomUUID(), 
        isConfirmed: false,
        uid: user.uid
      };
      try {
        await setDoc(doc(db, 'rows', newRow.id), newRow);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `rows/${newRow.id}`);
      }
    }
  };

  const getExpirationStatus = (obDate: string, validityDays: string) => {
    if (!obDate || !validityDays) return { status: 'normal', daysLeft: null };
    
    const start = new Date(obDate);
    const days = parseInt(validityDays);
    if (isNaN(days)) return { status: 'normal', daysLeft: null };

    const expiration = new Date(start);
    expiration.setDate(expiration.getDate() + days);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiration.setHours(0, 0, 0, 0);

    const diffTime = expiration.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { status: 'expired', daysLeft: diffDays };
    if (diffDays <= 5) return { status: 'warning', daysLeft: diffDays };
    return { status: 'normal', daysLeft: diffDays };
  };

  const parseValue = (val: string) => {
    if (!val) return 0;
    const clean = val.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  };

  const chartData = rows
    .filter(r => r.neNumber && r.value)
    .map(r => ({
      name: r.neNumber.slice(-6),
      fullLabel: r.neNumber,
      valor: parseValue(r.value)
    }))
    .slice(-10);

  const pieData = [
    { name: 'Lançado', value: rows.filter(r => r.isConfirmed).length, color: '#10b981' },
    { name: 'Pendente', value: rows.filter(r => !r.isConfirmed).length, color: '#94a3b8' }
  ].filter(d => d.value > 0);

  const filteredRows = rows.filter(row => 
    Object.values(row).some(val => 
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  const totalValue = rows.reduce((acc, row) => acc + parseValue(row.value), 0);

  const shareDashboard = () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('view', 'dashboard');
    navigator.clipboard.writeText(url.toString());
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (!isLoaded || !isAuthReady) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user && !isDashboardOnly) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl border border-blue-100 max-w-md w-full text-center">
          <div className="p-4 bg-blue-600 rounded-3xl shadow-xl shadow-blue-200 w-20 h-20 flex items-center justify-center mx-auto mb-8">
            <FileSpreadsheet className="text-white" size={40} />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-2">Controle SFI 2026</h1>
          <p className="text-slate-500 mb-10 font-medium">Faça login para acessar e sincronizar sua planilha em qualquer dispositivo.</p>
          
          <button 
            onClick={() => signInWithPopup(auth, googleProvider)}
            className="w-full py-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-slate-700 hover:border-blue-500 hover:bg-blue-50 transition-all flex items-center justify-center gap-3 shadow-sm active:scale-[0.98]"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Entrar com Google
          </button>
          
          <div className="mt-10 pt-8 border-t border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Desenvolvido para Gestão de OBs</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 selection:bg-blue-100 selection:text-blue-900">
        <div className="max-w-[1850px] mx-auto px-4 sm:px-6 lg:px-8 py-10">

          
          {/* Header Section */}
          <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200">
                <FileSpreadsheet className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900 leading-none mb-1">
                  Controle SFI 2026
                </h1>
                <p className="text-blue-600 text-[10px] font-black uppercase tracking-[0.25em]">Gestão de Notas de Empenho e Ordens Bancárias</p>
              </div>
            </div>

            {!isDashboardOnly && (
              <div className="flex flex-wrap items-center gap-3">
                {user && (
                  <div className="flex items-center gap-3 mr-4 bg-white px-4 py-1.5 rounded-2xl border border-blue-50 shadow-sm">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden border border-blue-200">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.displayName || ''} referrerPolicy="no-referrer" />
                      ) : (
                        <UserIcon size={16} className="text-blue-600" />
                      )}
                    </div>
                    <div className="hidden sm:block">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider leading-none mb-0.5">Usuário</p>
                      <p className="text-xs font-bold text-slate-700 leading-none">{user.displayName || user.email}</p>
                    </div>
                    <button 
                      onClick={() => signOut(auth)}
                      className="ml-2 p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                      title="Sair"
                    >
                      <LogOut size={16} />
                    </button>
                  </div>
                )}

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="Pesquisar..." 
                    className="pl-10 pr-4 py-2 bg-white border border-blue-100 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-full md:w-64 shadow-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                
                <button 
                  onClick={() => setShowDashboard(!showDashboard)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black uppercase tracking-wider transition-all ${
                    showDashboard 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-200' 
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm'
                  }`}
                >
                  <LayoutDashboard size={16} />
                  Dashboard
                </button>

                <button 
                  onClick={shareDashboard}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black uppercase tracking-wider hover:bg-slate-50 transition-all text-slate-700 shadow-sm"
                >
                  {copySuccess ? <Check size={16} className="text-emerald-500" /> : <Share2 size={16} />}
                  {copySuccess ? 'Copiado' : 'Compartilhar'}
                </button>
              </div>
            )}

            {isDashboardOnly && (
              <button 
                onClick={() => window.location.href = window.location.pathname}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black uppercase tracking-wider hover:bg-slate-50 transition-colors text-slate-700 shadow-sm"
              >
                <ExternalLink size={16} />
                Voltar para Planilha
              </button>
            )}
          </header>

          {/* Dashboard Section */}
          <AnimatePresence>
            {showDashboard && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mb-8"
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white p-6 rounded-2xl border border-blue-100 shadow-sm">
                  <div className="h-[300px]">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                      <BarChart3 size={16} className="text-blue-500" />
                      Valores por NE (Últimos 10)
                    </h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="name" 
                          fontSize={10} 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#64748b', fontWeight: 700 }}
                        />
                        <YAxis 
                          fontSize={10} 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#64748b', fontWeight: 700 }}
                          tickFormatter={(val) => `R$ ${val}`} 
                        />
                        <Tooltip 
                          contentStyle={{ 
                            borderRadius: '12px', 
                            border: 'none', 
                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                            fontFamily: 'Inter, sans-serif'
                          }}
                          formatter={(val: number) => [new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val), 'Valor']}
                        />
                        <Bar dataKey="valor" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="h-[300px]">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                      <PieChartIcon size={16} className="text-emerald-500" />
                      Status de Lançamento
                    </h3>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ 
                            borderRadius: '12px', 
                            border: 'none', 
                            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                            fontFamily: 'Inter, sans-serif'
                          }}
                        />
                        <Legend 
                          verticalAlign="bottom" 
                          height={36}
                          formatter={(value) => <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!isDashboardOnly && (
            <>
              {/* Stats Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl border border-blue-100 shadow-sm transition-all hover:shadow-md hover:border-blue-200 group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Total de Registros</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-4xl font-black text-slate-900 group-hover:text-blue-600 transition-colors">{rows.length}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">itens</p>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-emerald-100 shadow-sm transition-all hover:shadow-md hover:border-emerald-200 group">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3">Valor Total Acumulado</p>
                  <p className="text-3xl font-black text-emerald-600 tracking-tighter group-hover:scale-[1.02] origin-left transition-transform">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalValue)}
                  </p>
                </div>
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 transition-all hover:shadow-md group">
                  <div className="p-3 rounded-xl transition-all group-hover:scale-110 bg-blue-50 text-blue-600 border border-blue-100">
                    <Check size={24} strokeWidth={3} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-0.5">Status do Sistema</p>
                    <p className="text-base font-black text-slate-800 tracking-tight">Offline (Local)</p>
                  </div>
                </div>
              </div>

              {/* Main Table Container */}
              <div className="bg-white rounded-2xl border border-blue-100 shadow-xl shadow-blue-500/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-blue-100">
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-44">Identificação NE</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-32">Tipo</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-36">Data da OB</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-28 text-center">Validade</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-48 text-right">Valor Bruto</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-36">Data RE</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-36">Prestação</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-36">Vencimento</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50 w-44">Link Externo</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] border-r border-blue-50">Observações Gerais</th>
                        <th className="px-4 py-3 text-[11px] font-black text-slate-500 uppercase tracking-[0.15em] w-32 text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <AnimatePresence initial={false}>
                        {filteredRows.map((row) => {
                          const expiration = getExpirationStatus(row.obDate, row.obValidityDays);
                          return (
                            <motion.tr 
                              key={row.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, x: -20 }}
                              className={`transition-all group border-l-4 ${
                                expiration.status === 'expired' 
                                  ? 'bg-rose-50/30 hover:bg-rose-50/60 border-l-rose-500' 
                                  : expiration.status === 'warning'
                                    ? 'bg-amber-50/30 hover:bg-amber-50/60 border-l-amber-500'
                                    : 'hover:bg-slate-50/80 border-l-transparent'
                              }`}
                            >
                              <td className="p-0 border-r border-blue-50">
                                <div className="flex items-center gap-3 px-6 py-4">
                                  {expiration.status !== 'normal' && (
                                    <div className={
                                      expiration.status === 'expired' 
                                        ? 'text-rose-500 animate-pulse' 
                                        : 'text-amber-500'
                                    } title={
                                      expiration.status === 'expired'
                                        ? 'OB Vencida!'
                                        : `Vence em ${expiration.daysLeft} dias`
                                    }>
                                      <AlertCircle size={16} />
                                    </div>
                                  )}
                                  <input 
                                    type="text" 
                                    value={row.neNumber}
                                    onChange={(e) => updateRow(row.id, 'neNumber', e.target.value)}
                                    className="w-full bg-transparent focus:outline-none text-sm font-mono font-bold text-slate-700 placeholder:text-slate-300"
                                    placeholder="0000NE00000"
                                  />
                                </div>
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <select 
                                  value={row.type}
                                  onChange={(e) => updateRow(row.id, 'type', e.target.value)}
                                  className="w-full px-3 py-3 bg-transparent focus:outline-none focus:bg-white focus:ring-4 focus:ring-inset focus:ring-blue-500/10 text-xs font-bold text-slate-600 appearance-none cursor-pointer"
                                >
                                  <option value="">Selecione...</option>
                                  <option value="Consumo">Consumo</option>
                                  <option value="Serviço">Serviço</option>
                                  <option value="Extra">Extra</option>
                                </select>
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <input 
                                  type="date" 
                                  value={row.obDate}
                                  onChange={(e) => updateRow(row.id, 'obDate', e.target.value)}
                                  className="w-full px-3 py-3 bg-transparent focus:outline-none focus:bg-white focus:ring-4 focus:ring-inset focus:ring-blue-500/10 text-sm font-mono font-semibold text-slate-600"
                                />
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <input 
                                  type="number" 
                                  value={row.obValidityDays}
                                  onChange={(e) => updateRow(row.id, 'obValidityDays', e.target.value)}
                                  className="w-full px-3 py-3 bg-transparent focus:outline-none focus:bg-white focus:ring-4 focus:ring-inset focus:ring-blue-500/10 text-sm text-center font-mono font-bold text-slate-500"
                                  placeholder="30"
                                />
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <input 
                                  type="text" 
                                  value={row.value}
                                  onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                                  className="w-full px-3 py-3 bg-transparent focus:outline-none focus:bg-white focus:ring-4 focus:ring-inset focus:ring-blue-500/10 text-sm font-mono text-right font-bold text-blue-600"
                                  placeholder="0,00"
                                />
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <input 
                                  type="date" 
                                  value={row.reDate}
                                  onChange={(e) => updateRow(row.id, 'reDate', e.target.value)}
                                  className="w-full px-3 py-3 bg-transparent focus:outline-none focus:bg-white focus:ring-4 focus:ring-inset focus:ring-blue-500/10 text-sm font-mono font-semibold text-slate-600"
                                />
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <input 
                                  type="date" 
                                  value={row.prestacaoDate}
                                  onChange={(e) => updateRow(row.id, 'prestacaoDate', e.target.value)}
                                  className="w-full px-3 py-3 bg-transparent focus:outline-none focus:bg-white focus:ring-4 focus:ring-inset focus:ring-blue-500/10 text-sm font-mono font-semibold text-slate-600"
                                />
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <input 
                                  type="date" 
                                  value={row.vencimentoDate}
                                  readOnly
                                  className="w-full px-3 py-3 bg-blue-50/30 focus:outline-none text-sm font-mono font-bold text-blue-700 cursor-default"
                                  title="Calculado automaticamente"
                                />
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <div className="flex items-center px-4 py-1 gap-2">
                                  <input 
                                    type="text" 
                                    value={row.externalLink}
                                    onChange={(e) => updateRow(row.id, 'externalLink', e.target.value)}
                                    className="w-full py-3 bg-transparent focus:outline-none text-xs font-medium text-blue-600 placeholder:text-slate-300"
                                    placeholder="https://..."
                                  />
                                  {row.externalLink && (
                                    <a 
                                      href={row.externalLink.startsWith('http') ? row.externalLink : `https://${row.externalLink}`} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Abrir link"
                                    >
                                      <ExternalLink size={14} />
                                    </a>
                                  )}
                                </div>
                              </td>
                              <td className="p-0 border-r border-blue-50">
                                <div className="flex items-center px-4 py-1 gap-3">
                                  <button 
                                    onClick={() => toggleConfirm(row.id)}
                                    className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm ${
                                      row.isConfirmed 
                                        ? 'bg-emerald-500 text-white shadow-emerald-200' 
                                        : 'bg-white border border-slate-200 text-slate-300 hover:text-slate-500 hover:border-slate-300'
                                    } active:scale-90`}
                                    title={row.isConfirmed ? 'Confirmado' : 'Marcar como lançado'}
                                  >
                                    {row.isConfirmed ? <Check size={18} strokeWidth={3} /> : <Check size={18} />}
                                  </button>
                                  <input 
                                    type="text" 
                                    value={row.lancadoPlanilha}
                                    onChange={(e) => updateRow(row.id, 'lancadoPlanilha', e.target.value)}
                                    className={`w-full py-3 bg-transparent focus:outline-none text-sm font-medium placeholder:text-slate-300 ${row.isConfirmed ? 'text-emerald-700' : 'text-slate-600'}`}
                                    placeholder="Observações..."
                                  />
                                </div>
                              </td>
                              <td className="px-4 py-0 text-center">
                                <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                  <button 
                                    onClick={() => setEditingRow(row)}
                                    className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all active:scale-90"
                                    title="Editar linha"
                                  >
                                    <Pencil size={16} />
                                  </button>
                                  <button 
                                    onClick={() => duplicateRow(row.id)}
                                    className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all active:scale-90"
                                    title="Duplicar linha"
                                  >
                                    <Copy size={16} />
                                  </button>
                                  <button 
                                    onClick={() => deleteRow(row.id)}
                                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all active:scale-90"
                                    title="Excluir linha"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </motion.tr>
                          );
                        })}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
                
                <div className="p-6 bg-slate-50/50 border-t border-blue-100 flex flex-col sm:flex-row justify-between items-center gap-6">
                  <button 
                    onClick={addRow}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 active:scale-95 transition-all shadow-lg shadow-blue-500/20"
                  >
                    <Plus size={16} strokeWidth={3} />
                    Nova Linha
                  </button>
                  <div className="flex items-center gap-3 px-4 py-2 bg-white border border-blue-100 rounded-xl shadow-sm">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <p className="text-[10px] text-slate-500 font-black uppercase tracking-wider">
                      Armazenamento Local Ativo
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {searchTerm && filteredRows.length === 0 && (
            <div className="mt-12 text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300">
              <Search size={48} className="mx-auto text-slate-200 mb-4" />
              <h3 className="text-lg font-black text-slate-900">Nenhum resultado encontrado</h3>
              <p className="text-slate-500 text-sm">Tente ajustar sua pesquisa para encontrar o que procura.</p>
            </div>
          )}
        </div>

        {/* Edit Modal */}
        <AnimatePresence>
          {editingRow && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-blue-100"
              >
                <div className="px-8 py-6 bg-slate-50 border-b border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-xl text-white">
                      <Pencil size={20} />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-slate-900 tracking-tight">Editar Registro</h2>
                      <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Nota de Empenho: {editingRow.neNumber || 'Sem identificação'}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setEditingRow(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-xl transition-all"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Identificação NE</label>
                    <input 
                      type="text" 
                      value={editingRow.neNumber}
                      onChange={(e) => setEditingRow({...editingRow, neNumber: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-mono font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo</label>
                    <select 
                      value={editingRow.type}
                      onChange={(e) => setEditingRow({...editingRow, type: e.target.value as any})}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    >
                      <option value="">Selecione...</option>
                      <option value="Consumo">Consumo</option>
                      <option value="Serviço">Serviço</option>
                      <option value="Extra">Extra</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Data da OB</label>
                    <input 
                      type="date" 
                      value={editingRow.obDate}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        const newVencimento = calculateVencimento(newDate, editingRow.obValidityDays);
                        setEditingRow({...editingRow, obDate: newDate, vencimentoDate: newVencimento});
                      }}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-mono font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Validade (Dias)</label>
                    <input 
                      type="number" 
                      value={editingRow.obValidityDays}
                      onChange={(e) => {
                        const newDays = e.target.value;
                        const newVencimento = calculateVencimento(editingRow.obDate, newDays);
                        setEditingRow({...editingRow, obValidityDays: newDays, vencimentoDate: newVencimento});
                      }}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-mono font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Valor Bruto</label>
                    <input 
                      type="text" 
                      value={editingRow.value}
                      onChange={(e) => setEditingRow({...editingRow, value: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-mono font-bold text-blue-600 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Data RE</label>
                    <input 
                      type="date" 
                      value={editingRow.reDate}
                      onChange={(e) => setEditingRow({...editingRow, reDate: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-mono font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Prestação</label>
                    <input 
                      type="date" 
                      value={editingRow.prestacaoDate}
                      onChange={(e) => setEditingRow({...editingRow, prestacaoDate: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-mono font-bold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Link Externo</label>
                    <input 
                      type="text" 
                      value={editingRow.externalLink}
                      onChange={(e) => setEditingRow({...editingRow, externalLink: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-medium text-blue-600 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                      placeholder="https://..."
                    />
                  </div>

                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Observações Gerais</label>
                    <textarea 
                      value={editingRow.lancadoPlanilha}
                      onChange={(e) => setEditingRow({...editingRow, lancadoPlanilha: e.target.value})}
                      rows={3}
                      className="w-full px-4 py-3 bg-slate-50 border border-blue-100 rounded-xl text-sm font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all resize-none"
                    />
                  </div>
                </div>

                <div className="px-8 py-6 bg-slate-50 border-t border-blue-100 flex items-center justify-end gap-3">
                  <button 
                    onClick={() => setEditingRow(null)}
                    className="px-6 py-2.5 rounded-xl text-sm font-black uppercase tracking-widest text-slate-500 hover:bg-slate-200 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={async () => {
                      if (!user) return;
                      try {
                        await setDoc(doc(db, 'rows', editingRow.id), editingRow);
                        setEditingRow(null);
                      } catch (error) {
                        handleFirestoreError(error, OperationType.UPDATE, `rows/${editingRow.id}`);
                      }
                    }}
                    className="px-8 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-black uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all"
                  >
                    Salvar Alterações
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
