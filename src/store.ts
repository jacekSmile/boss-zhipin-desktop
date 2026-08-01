// 全局状态（轻量 React Context）
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppSettings,
  Job,
  JobDetail,
  LoginState,
  SearchFilters,
  ToastItem,
  ToastType,
} from "./types";
import { DEFAULT_TEMPLATE } from "./constants";

const SETTINGS_KEY = "bz_settings";
const QUEUE_KEY = "bz_queue";

function loadQueue(): Job[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Job[];
    return Array.isArray(arr) ? arr.filter((j) => j && j.encryptJobId) : [];
  } catch {
    return [];
  }
}

function persistQueue(q: Job[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* 存储满等异常忽略 */
  }
}

function loadSettings(): AppSettings {
  const def: AppSettings = {
    template: DEFAULT_TEMPLATE,
    minDelaySec: 8,
    maxDelaySec: 20,
    pageSize: 30,
    selfIntro: "",
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    /* ignore */
  }
  return def;
}

export interface Store {
  // 登录 / 窗口
  login: LoginState;
  setLogin: (s: LoginState) => void;
  bossOpen: boolean;
  setBossOpen: (b: boolean) => void;
  // 搜索
  jobs: Job[];
  setJobs: (j: Job[]) => void;
  lastFilters: SearchFilters | null;
  setLastFilters: (f: SearchFilters) => void;
  // 选择
  selected: Set<string>;
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  // 投递队列
  queue: Job[];
  addToQueue: (jobs: Job[]) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  // 统计会话数据（跨搜索累积）
  sessionJobs: Map<string, Job>;
  addSessionJobs: (jobs: Job[]) => void;
  clearSessionJobs: () => void;
  // 详情缓存
  details: Map<string, JobDetail>;
  cacheDetail: (id: string, d: JobDetail) => void;
  // 设置
  settings: AppSettings;
  updateSettings: (p: Partial<AppSettings>) => void;
  // 历史版本号（批次完成后递增，供其他页面刷新历史数据）
  historyVersion: number;
  bumpHistory: () => void;
  // Toast
  toasts: ToastItem[];
  toast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<Store | null>(null);

let toastSeq = 1;

export function StoreProvider(props: { children: ReactNode }) {
  const [login, setLogin] = useState<LoginState>("unknown");
  const [bossOpen, setBossOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [lastFilters, setLastFilters] = useState<SearchFilters | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Job[]>(loadQueue);
  const [sessionJobs, setSessionJobs] = useState<Map<string, Job>>(new Map());
  const [details, setDetails] = useState<Map<string, JobDetail>>(new Map());
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = toastSeq++;
      setToasts((t) => [...t.slice(-4), { id, type, message }]);
      const tm = setTimeout(() => dismissToast(id), type === "error" ? 8000 : 4500);
      timers.current.set(id, tm);
    },
    [dismissToast]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected((s) => {
      const all = ids.every((id) => s.has(id));
      return all ? new Set<string>() : new Set(ids);
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const addToQueue = useCallback(
    (jobsToAdd: Job[]) => {
      setQueue((q) => {
        const have = new Set(q.map((j) => j.encryptJobId));
        const fresh = jobsToAdd.filter((j) => !have.has(j.encryptJobId));
        if (fresh.length < jobsToAdd.length) {
          toast("部分职位已在队列中，已自动去重", "warning");
        }
        const next = [...q, ...fresh];
        persistQueue(next);
        return next;
      });
    },
    [toast]
  );

  const removeFromQueue = useCallback((id: string) => {
    setQueue((q) => {
      const next = q.filter((j) => j.encryptJobId !== id);
      persistQueue(next);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    persistQueue([]);
    setQueue([]);
  }, []);

  const addSessionJobs = useCallback((jobsToAdd: Job[]) => {
    setSessionJobs((m) => {
      const n = new Map(m);
      for (const j of jobsToAdd) n.set(j.encryptJobId, j);
      return n;
    });
  }, []);

  const clearSessionJobs = useCallback(() => setSessionJobs(new Map()), []);

  const cacheDetail = useCallback((id: string, d: JobDetail) => {
    setDetails((m) => {
      const n = new Map(m);
      n.set(id, d);
      return n;
    });
  }, []);

  const updateSettings = useCallback((p: Partial<AppSettings>) => {
    setSettings((s) => {
      const n = { ...s, ...p };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });
  }, []);

  const value = useMemo<Store>(
    () => ({
      login, setLogin, bossOpen, setBossOpen,
      jobs, setJobs, lastFilters, setLastFilters,
      selected, toggleSelect, selectAll, clearSelection,
      queue, addToQueue, removeFromQueue, clearQueue,
      sessionJobs, addSessionJobs, clearSessionJobs,
      details, cacheDetail,
      settings, updateSettings,
      historyVersion, bumpHistory,
      toasts, toast, dismissToast,
    }),
    [
      login, bossOpen, jobs, lastFilters, selected, queue, sessionJobs, details,
      settings, historyVersion, toasts, toggleSelect, selectAll, clearSelection,
      addToQueue, removeFromQueue, clearQueue, addSessionJobs, clearSessionJobs,
      cacheDetail, updateSettings, bumpHistory, toast, dismissToast,
    ]
  );

  return createElement(Ctx.Provider, { value }, props.children);
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore 必须在 StoreProvider 内使用");
  return s;
}
