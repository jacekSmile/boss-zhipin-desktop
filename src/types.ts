// 全局类型定义

/** 搜索结果中的职位条目（对应 BOSS joblist.json 的字段） */
export interface Job {
  jobName: string;
  salaryDesc: string;
  cityName: string;
  areaDistrict?: string;
  businessDistrict?: string;
  jobExperience?: string;
  jobDegree?: string;
  brandName: string;
  bossTitle?: string;
  bossOnline?: boolean;
  activeTimeDesc?: string;
  brandScaleName?: string;
  brandStageName?: string;
  brandIndustry?: string;
  jobLabels?: string[];
  skills?: string[];
  welfareList?: string[];
  securityId?: string;
  lid?: string;
  encryptJobId: string;
  encryptBossId?: string;
  encryptBrandId?: string;
}

/** 职位详情（从详情页 HTML 解析） */
export interface JobDetail {
  jd: string;
  skills: string[];
}

/** 聊天会话列表条目 */
export interface Conversation {
  index: number;
  title: string;
  preview: string;
  unread: boolean;
}

/** 聊天消息 */
export interface ChatMessage {
  from: "me" | "boss";
  text: string;
}

/** 投递历史记录 */
export interface HistoryRecord {
  time: string;
  jobName: string;
  brandName: string;
  encryptJobId: string;
  ok: boolean;
  error: string | null;
}

/** 后端 batch-progress 事件负载（snake_case 字段） */
export interface BatchProgressPayload {
  current: number;
  total: number;
  item_id: string;
  label: string;
  ok: boolean;
  error: string | null;
  result: unknown;
  done: boolean;
}

/** 简历文件信息 */
export interface ResumeInfo {
  name: string;
  size: number;
  modified_ms: number;
  ext: string;
}

/** 搜索过滤条件 */
export interface SearchFilters {
  query: string;
  city: string; // 9 位城市代码
  cityName: string;
  salary: string;
  experience: string;
  degree: string;
  scale: string;
  stage: string;
  industry: string;
}

export type LoginState =
  | "unknown"
  | "no-window"
  | "logged-in"
  | "not-logged-in"
  | "risk";

export type ViewKey =
  | "search"
  | "batch"
  | "chat"
  | "stats"
  | "resumes"
  | "history"
  | "settings";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

/** 应用设置（localStorage 持久化） */
export interface AppSettings {
  template: string;
  minDelaySec: number;
  maxDelaySec: number;
  pageSize: number;
  selfIntro: string;
}

declare global {
  interface Window {
    __TAURI__?: {
      opener?: { openUrl?: (url: string) => Promise<void> };
      [key: string]: unknown;
    };
  }
}
