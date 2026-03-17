"use client";

import type { ReactNode } from "react";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { isPublicAccessEnabled } from "@/lib/supabase/config";

type RunState = {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
  last_stdout: string;
  last_stderr: string;
  last_command: string[];
  last_result_stamp: string | null;
  runtime_notes: string[];
  last_config: {
    keywords: string[];
    mode: string;
    pages: number;
    goal: string;
    batch_size: number;
    max_results: number;
    no_openclaw: boolean;
    deep_dive_authors: number;
  } | null;
};

type RunFile = {
  name: string;
  url: string;
};

type RunMeta = {
  stamp: string;
  created_at: string;
  files: {
    csv?: RunFile;
    json?: RunFile;
    brief?: RunFile;
    deepdive?: RunFile;
  };
};

type StatusResponse = {
  script_path: string;
  script_exists: boolean;
  output_dir: string;
  dependencies: {
    xhs: {
      path: string;
      installed: boolean;
      logged_in: boolean;
      status: string;
    };
    openclaw: {
      path: string;
      installed: boolean;
      status: string;
    };
  };
  run_ready: boolean;
  run_blockers: string[];
  state: RunState;
  latest_run: RunMeta | null;
  recent_runs: RunMeta[];
};

type ResultRow = {
  note_id: string;
  title: string;
  desc: string;
  author: string;
  keyword: string;
  url: string;
  publish_time: string;
  relevance_score?: number;
  final_label?: string;
  rule_label?: string;
  summary?: string;
  why_it_matters?: string;
  outreach_angle?: string;
  founder_stage?: string;
  category?: string;
  noise_reason?: string;
  liked_count?: string;
  comment_count?: string;
  collected_count?: string;
  investor_fit_score?: number;
  opportunity_bucket?: "priority" | "watchlist" | "review" | "low_signal";
  signal_summary?: string;
  risk_flags?: string;
  operator_signal_count?: number;
  topic_tags?: string[];
  comment_preview?: string;
  feedback_count?: number;
  author_reply_count?: number;
  has_author_reply?: boolean;
  observed_comment_count?: number;
  external_proof?: string[];
  detail_ip_location?: string;
  author_bio?: string;
  author_ip_location?: string;
  author_fans?: string;
  author_recent_post_count?: number;
  author_founderish_post_count?: number;
  author_founder_consistency_score?: number;
  author_top_titles?: string[];
};

type ResultResponse = {
  run: RunMeta;
  summary: {
    total_results: number;
    best_score: number;
    best_investor_fit_score: number;
    label_counts: Record<string, number>;
    stage_counts: Record<string, number>;
    opportunity_counts: Record<string, number>;
    top_authors: { name: string; count: number }[];
  };
  rows: ResultRow[];
  brief_markdown: string;
  deepdive_markdown: string;
};

type FormState = {
  mode: "founder" | "general";
  pages: number;
  batch_size: number;
  max_results: number;
  deep_dive_authors: number;
  no_openclaw: boolean;
  goal: string;
  keywordsText: string;
};

type RunProgressSummary = {
  tone: "idle" | "running" | "completed" | "error";
  phase: string;
  detail: string;
  progress: number;
  warningCount: number;
  lastLine: string;
};

type ThemeMode = "light" | "dark" | "auto";

type WorkspaceProfile = {
  name: string;
  handle: string;
  role: string;
  plan: string;
};

const PUBLIC_WORKSPACE_PROFILE: WorkspaceProfile = {
  name: "公开工作台",
  handle: "@public",
  role: "免登录访问",
  plan: "打开即用",
};

const ACCESS_LOCK_MESSAGE =
  "当前前端是无登录版，但后端仍开启了鉴权。请在后端设置 PUBLIC_ACCESS_ENABLED=1，或兼容使用 AUTH_BYPASS_ENABLED=1。";

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as {
      detail?: string;
      error?: string;
      state?: { last_error?: string | null };
    };
    return payload.detail || payload.error || payload.state?.last_error || fallback;
  } catch {
    return fallback;
  }
}

const builderKeywordPreset = [
  "独立开发者",
  "创业者",
  "联创",
  "寻找合伙人",
  "招联创",
  "build in public",
  "从0到1",
  "做了个",
  "上线了",
  "刚上线",
  "内测",
  "公测",
  "demo",
  "MVP",
  "第一个用户",
  "第一个客户",
  "冷启动",
  "复盘",
  "用户访谈",
].join("\n");

const problemKeywordPreset = [
  "拖延 app",
  "ADHD 工具",
  "专注 产品",
  "饮食记录 AI",
  "健康管理 内测",
  "睡眠 工具",
  "焦虑 产品",
  "知识管理 上线",
  "播客摘要 工具",
  "宠物友好 地图",
  "出海 第一个客户",
  "跨境内容 产品",
  "面试准备 工具",
  "阅读辅助 app",
].join("\n");

const founderMarketKeywordPreset = [
  "产品上线",
  "内测",
  "公测",
  "招人",
  "用户增长",
  "留存",
  "付费用户",
  "签约客户",
  "营收",
  "MRR",
  "ARR",
  "PMF",
  "天使轮",
  "种子轮",
  "融资复盘",
  "B2B SaaS",
  "Agent",
  "出海创业",
].join("\n");

const wideDiscoveryKeywordPreset = [
  "独立开发者",
  "创业者",
  "联创",
  "寻找合伙人",
  "build in public",
  "做了个",
  "上线了",
  "内测",
  "公测",
  "MVP",
  "第一个用户",
  "第一个客户",
  "用户访谈",
  "复盘",
  "拖延 app",
  "ADHD 工具",
  "健康管理 内测",
  "睡眠 工具",
  "知识管理 上线",
  "播客摘要 工具",
  "宠物友好 地图",
  "出海 第一个客户",
  "面试准备 工具",
  "产品上线",
  "用户增长",
  "付费用户",
  "签约客户",
  "营收",
  "PMF",
  "天使轮",
  "种子轮",
  "融资复盘",
  "B2B SaaS",
  "Agent",
].join("\n");

const defaultForm: FormState = {
  mode: "founder",
  pages: 2,
  batch_size: 10,
  max_results: 120,
  deep_dive_authors: 12,
  no_openclaw: true,
  goal: "做一轮偏宽的 founder discovery 扫描，优先找正在解决真实问题、持续公开构建产品、已经出现真实反馈或外部证据的创业者与早期项目，同时过滤课程、流量、社群、卖课和泛创业内容。",
  keywordsText: wideDiscoveryKeywordPreset,
};

const RESULT_PAGE_SIZE = 30;
const THEME_STORAGE_KEY = "xhs-workbench-theme";
const AUTO_DARK_START_HOUR = 19;
const AUTO_DARK_END_HOUR = 7;
const HOVER_PREVIEW_MEDIA_QUERY = "(hover: hover) and (pointer: fine)";
type SectionIconName =
  | "settings"
  | "server"
  | "log"
  | "warning"
  | "spark"
  | "note"
  | "results"
  | "run"
  | "history"
  | "export"
  | "user";

const SECTION_ICONS: Record<string, SectionIconName> = {
  "采集配置": "settings",
  "运行配置": "settings",
  "后端环境": "server",
  "运行环境": "server",
  "任务日志": "log",
  "运行日志": "log",
  "异常记录": "warning",
  "最近失败": "warning",
  "结果概览": "spark",
  "线索概览": "spark",
  "信号概览": "spark",
  "研究简报": "note",
  "简报": "note",
  "结果列表": "results",
  "结果浏览": "results",
  "工作台概览": "user",
};

function parseKeywords(input: string) {
  return input
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value: string | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveThemeMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "auto") {
    const hour = new Date().getHours();
    return hour >= AUTO_DARK_START_HOUR || hour < AUTO_DARK_END_HOUR ? "dark" : "light";
  }
  return mode;
}

function getThemeModeLabel(mode: ThemeMode) {
  switch (mode) {
    case "dark":
      return "黑夜";
    case "light":
      return "浅色";
    default:
      return "自动";
  }
}

function getNextThemeMode(mode: ThemeMode) {
  if (mode === "auto") return "dark";
  if (mode === "dark") return "light";
  return "auto";
}

function displayBucket(bucket: ResultRow["opportunity_bucket"] | string | null | undefined) {
  if (bucket === "priority") return "优先";
  if (bucket === "watchlist") return "观察";
  if (bucket === "review") return "复核";
  if (bucket === "low_signal") return "低信号";
  return bucket || "未评分";
}

function progressBetween(current: number, total: number, start: number, end: number) {
  if (!total) return start;
  const ratio = Math.max(0, Math.min(1, current / total));
  return start + ratio * (end - start);
}

function findLastMatch(lines: string[], pattern: RegExp) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(pattern);
    if (match) return match;
  }
  return null;
}

function summarizeRunProgress(status: StatusResponse | null): RunProgressSummary {
  if (!status) {
    return {
      tone: "idle",
      phase: "等待中",
      detail: "正在加载运行状态",
      progress: 0,
      warningCount: 0,
      lastLine: "",
    };
  }

  const state = status.state;
  const lines = state.last_stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const warningCount = lines.filter((line) => line.startsWith("[warn]")).length;
  const lastLine = [...lines].reverse().find((line) => !line.startsWith("[warn]")) || lines.at(-1) || "";
  const searchTarget =
    state.last_config?.max_results ||
    Number(findLastMatch(lines, /\[export\] enriched_total=(\d+)/)?.[1] || 0) ||
    120;

  const searchMatch = findLastMatch(lines, /\[search\].*total=(\d+)/);
  const dedupedMatch = findLastMatch(lines, /\[search\] deduped_total=(\d+)/);
  const detailMatch = findLastMatch(lines, /\[detail\] note=(\d+)\/(\d+)/);
  const enrichMatch =
    findLastMatch(lines, /\[enrich\] completed rows=(\d+)\/(\d+)/) ||
    findLastMatch(lines, /\[enrich\] batch=\d+ rows=\d+-(\d+)\/(\d+)/);
  const authorScanMatch = findLastMatch(lines, /\[author-scan\].*\((\d+)\/(\d+)\)/);
  const deepDiveMatch = findLastMatch(lines, /\[deep-dive\].*\((\d+)\/(\d+)\)/);
  const exportMatch = findLastMatch(lines, /\[export\] enriched_total=(\d+)/);

  let phase = "空闲";
  let detail = status.run_ready
    ? "准备就绪，可启动新一轮抓取"
    : status.run_blockers.length
      ? `启动前还缺：${status.run_blockers.join("、")}`
      : status.script_exists
        ? "运行环境尚未完全就绪"
        : "脚本路径不存在，当前不可运行";
  let progress = 0;

  if (deepDiveMatch) {
    const current = Number(deepDiveMatch[1]);
    const total = Number(deepDiveMatch[2]);
    phase = "作者深挖";
    detail = `作者深挖 ${current}/${total}`;
    progress = progressBetween(current, total, 88, 99);
  } else if (authorScanMatch) {
    const current = Number(authorScanMatch[1]);
    const total = Number(authorScanMatch[2]);
    phase = "作者扫描";
    detail = `作者扫描 ${current}/${total}`;
    progress = progressBetween(current, total, 76, 88);
  } else if (enrichMatch) {
    const current = Number(enrichMatch[1]);
    const total = Number(enrichMatch[2]);
    phase = "增强处理中";
    detail = `增强处理中 ${current}/${total}`;
    progress = progressBetween(current, total, 48, 76);
  } else if (detailMatch) {
    const current = Number(detailMatch[1]);
    const total = Number(detailMatch[2]);
    phase = "详情抓取";
    detail = `详情抓取 ${current}/${total}`;
    progress = progressBetween(current, total, 18, 48);
  } else if (dedupedMatch) {
    const total = Number(dedupedMatch[1]);
    phase = "搜索采集";
    detail = `检索完成，去重后 ${total} 条`;
    progress = 18;
  } else if (searchMatch) {
    const current = Number(searchMatch[1]);
    phase = "搜索采集";
    detail = `检索中 ${current}/${searchTarget}`;
    progress = progressBetween(current, searchTarget, 4, 18);
  }

  if (state.last_error || ((state.last_exit_code ?? 0) !== 0 && !state.running)) {
    return {
      tone: "error",
      phase: "已阻塞",
      detail: state.last_error || "任务中断，请检查日志",
      progress,
      warningCount,
      lastLine,
    };
  }

  if (state.running) {
    return {
      tone: "running",
      phase: phase === "空闲" ? "启动中" : phase,
      detail: phase === "空闲" ? "任务已启动，等待第一条日志" : detail,
      progress: phase === "空闲" ? 3 : progress,
      warningCount,
      lastLine,
    };
  }

  if (exportMatch || state.finished_at || state.last_result_stamp || status.latest_run) {
    return {
      tone: "completed",
      phase: "已完成",
      detail: state.finished_at ? `完成于 ${formatTime(state.finished_at)}` : "本轮任务已完成",
      progress: 100,
      warningCount,
      lastLine: lastLine || `结果已就绪 ${state.last_result_stamp || status.latest_run?.stamp || ""}`.trim(),
    };
  }

  return {
    tone: status.run_ready ? "idle" : "error",
    phase: status.run_ready ? "空闲" : "已阻塞",
    detail,
    progress,
    warningCount,
    lastLine,
  };
}

function proofTone(label: string) {
  if (label === "testflight" || label === "app_store") {
    return "bg-black/[0.045] text-zinc-700 dark:bg-white/8 dark:text-zinc-200";
  }
  if (label === "github" || label === "website") {
    return "bg-black/[0.035] text-zinc-600 dark:bg-white/6 dark:text-zinc-300";
  }
  return "bg-black/[0.03] text-zinc-500 dark:bg-white/5 dark:text-zinc-400";
}

function formatProof(label: string) {
  return label.replaceAll("_", " ");
}

function cleanRiskText(value: string | null | undefined) {
  if (!value) return "";
  let cleaned = value.replace(/\s*\|\s*OpenClaw fallback:[\s\S]*$/, "").trim();
  if (cleaned.startsWith("Founder/operator signals:")) {
    const prefix = "Founder/operator signals:";
    const raw = cleaned.slice(prefix.length).split(",").map((item) => item.trim()).filter(Boolean);
    const deduped = Array.from(new Set(raw));
    cleaned = `${prefix} ${deduped.join(", ")}`.trim();
  }
  return cleaned;
}

function joinCompact(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim() || "").filter(Boolean).join(" · ");
}

function SectionIcon({ name }: { name: SectionIconName }) {
  const commonProps = {
    viewBox: "0 0 20 20",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-[20px] w-[20px]",
    "aria-hidden": true,
  };

  if (name === "settings") {
    return (
      <svg {...commonProps}>
        <path d="M4 5h8" />
        <path d="M14 5h2" />
        <circle cx="12" cy="5" r="1.5" />
        <path d="M4 10h2" />
        <path d="M10 10h6" />
        <circle cx="8" cy="10" r="1.5" />
        <path d="M4 15h7" />
        <path d="M15 15h1" />
        <circle cx="13" cy="15" r="1.5" />
      </svg>
    );
  }
  if (name === "server") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="4" width="12" height="4" rx="1.5" />
        <rect x="4" y="12" width="12" height="4" rx="1.5" />
        <path d="M7 6h.01" />
        <path d="M7 14h.01" />
        <path d="M10 6h5" />
        <path d="M10 14h5" />
      </svg>
    );
  }
  if (name === "log") {
    return (
      <svg {...commonProps}>
        <path d="M5 5h10" />
        <path d="M5 10h10" />
        <path d="M5 15h6" />
        <circle cx="3.5" cy="5" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="10" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="3.5" cy="15" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "warning") {
    return (
      <svg {...commonProps}>
        <path d="M10 4l6 10H4L10 4z" />
        <path d="M10 8.2v2.8" />
        <path d="M10 13.6h.01" />
      </svg>
    );
  }
  if (name === "spark") {
    return (
      <svg {...commonProps}>
        <path d="M10 3l1.4 3.6L15 8l-3.6 1.4L10 13l-1.4-3.6L5 8l3.6-1.4L10 3z" />
        <path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
      </svg>
    );
  }
  if (name === "note") {
    return (
      <svg {...commonProps}>
        <path d="M6 4h6l3 3v9H6z" />
        <path d="M12 4v3h3" />
        <path d="M8 11h5" />
        <path d="M8 14h4" />
      </svg>
    );
  }
  if (name === "results") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="5" width="12" height="10" rx="2" />
        <path d="M8 8.5h4" />
        <path d="M8 11.5h6" />
        <circle cx="6.5" cy="8.5" r="0.8" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (name === "run") {
    return (
      <svg {...commonProps}>
        <circle cx="6" cy="10" r="1.5" />
        <circle cx="10" cy="10" r="1.5" />
        <circle cx="14" cy="10" r="1.5" />
        <path d="M4 5.5h12" opacity="0.45" />
        <path d="M4 14.5h12" opacity="0.45" />
      </svg>
    );
  }
  if (name === "history") {
    return (
      <svg {...commonProps}>
        <path d="M4.5 10a5.5 5.5 0 1 0 1.6-3.9" />
        <path d="M4.5 5.5v3h3" />
        <path d="M10 7.5v3l2 1.2" />
      </svg>
    );
  }
  if (name === "export") {
    return (
      <svg {...commonProps}>
        <path d="M10 4v7" />
        <path d="M7.5 8.5L10 11l2.5-2.5" />
        <path d="M5 14.5h10" />
      </svg>
    );
  }
  if (name === "user") {
    return (
      <svg {...commonProps}>
        <circle cx="10" cy="7" r="2.6" />
        <path d="M5.2 15.4c1.1-2.1 2.9-3.2 4.8-3.2s3.7 1.1 4.8 3.2" />
      </svg>
    );
  }
  return (
    <svg {...commonProps}>
      <path d="M5 5h10v10H5z" />
      <path d="M8 8h4" />
      <path d="M8 12h4" />
    </svg>
  );
}

function SectionHeader({
  icon,
  eyebrow,
  title,
  dense = false,
}: {
  icon: SectionIconName;
  eyebrow?: string;
  title: ReactNode;
  dense?: boolean;
}) {
  const hasEyebrow = Boolean(eyebrow);
  return (
    <div className="section-header min-w-0">
      <span className="section-icon">
        <SectionIcon name={icon} />
      </span>
      <div className={`section-header-copy min-w-0 ${hasEyebrow ? "" : "section-header-copy-plain"}`}>
        {eyebrow ? <div className="section-eyebrow">{eyebrow}</div> : null}
        <div
          className={`section-title ${dense ? "text-[13px]" : "text-[15px]"}`}
        >
          {title}
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
  actions,
  dense = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
}) {
  const icon = SECTION_ICONS[title] || "results";
  return (
    <section className={`ui-panel border-t border-black/6 ${dense ? "py-3" : "py-4"} dark:border-white/8`}>
      <div className={`flex items-center justify-between gap-3 ${dense ? "mb-2.5" : "mb-3.5"}`}>
        <SectionHeader icon={icon} eyebrow={eyebrow} title={title} dense={dense} />
        {actions}
      </div>
      {children}
    </section>
  );
}

function ControlGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="control-group px-0 py-0">
      <div className="mb-3">
        <div className="text-[11px] tracking-[0.14em] text-zinc-500 dark:text-zinc-400">{title}</div>
        {hint ? <div className="mt-1 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">{hint}</div> : null}
      </div>
      {children}
    </section>
  );
}

function UtilityHeader({
  icon,
  title,
  meta,
}: {
  icon: SectionIconName;
  title: string;
  meta?: ReactNode;
}) {
  return (
    <div className="utility-header">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="utility-icon">
          <SectionIcon name={icon} />
        </span>
        <div className="utility-title truncate">{title}</div>
      </div>
      {meta}
    </div>
  );
}

export default function XhsWorkbenchPage() {
  const publicAccessEnabled = isPublicAccessEnabled();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [result, setResult] = useState<ResultResponse | null>(null);
  const [selectedStamp, setSelectedStamp] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingResult, setLoadingResult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"priority" | "priority_plus" | "all">("all");
  const [evidenceFilter, setEvidenceFilter] = useState<
    "all" | "feedback" | "proof" | "history" | "high_fit"
  >("all");
  const deferredQuery = useDeferredValue(query);
  const resultRequestIdRef = useRef(0);
  const previousLatestStampRef = useRef<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [themeMode, setThemeMode] = useState<ThemeMode | null>(null);
  const [expandedPanels, setExpandedPanels] = useState<Record<"config" | "env" | "log" | "brief", boolean>>({
    config: false,
    env: false,
    log: false,
    brief: false,
  });
  const activeThemeMode = themeMode ?? "auto";
  const resolvedThemeMode = resolveThemeMode(activeThemeMode);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "auto") {
      setThemeMode(savedTheme);
      return;
    }
    setThemeMode("auto");
  }, []);

  useEffect(() => {
    if (!themeMode) return;
    const root = document.documentElement;
    const applyThemeMode = () => {
      const resolvedTheme = resolveThemeMode(themeMode);
      root.classList.toggle("dark", resolvedTheme === "dark");
      root.style.colorScheme = resolvedTheme;
    };
    applyThemeMode();
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    if (themeMode !== "auto") return;
    const timer = window.setInterval(applyThemeMode, 60_000);
    return () => window.clearInterval(timer);
  }, [themeMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(HOVER_PREVIEW_MEDIA_QUERY);
    const syncHoverPreview = () => setHoverPreviewEnabled(mediaQuery.matches);
    syncHoverPreview();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncHoverPreview);
      return () => mediaQuery.removeEventListener("change", syncHoverPreview);
    }
    mediaQuery.addListener(syncHoverPreview);
    return () => mediaQuery.removeListener(syncHoverPreview);
  }, []);

  useEffect(() => {
    if (hoverPreviewEnabled) return;
    setHoveredRowId(null);
  }, [hoverPreviewEnabled]);

  const handleAccessDenied = useCallback((message: string = ACCESS_LOCK_MESSAGE) => {
    setError(message);
  }, []);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`${API_BASE}/api/xhs/enrich/status`, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        handleAccessDenied();
        return;
      }
      if (!res.ok) {
        throw new Error(await readApiError(res, "加载运行状态失败"));
      }
      const data = (await res.json()) as StatusResponse;
      const latestStamp = data.latest_run?.stamp ?? null;
      const previousLatest = previousLatestStampRef.current;
      const wasFollowingLatest = !selectedStamp || selectedStamp === previousLatest;
      setStatus(data);
      if (latestStamp && wasFollowingLatest && latestStamp !== selectedStamp) {
        setSelectedStamp(latestStamp);
      }
      previousLatestStampRef.current = latestStamp;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载运行状态失败");
    } finally {
      setLoadingStatus(false);
    }
  }, [handleAccessDenied, selectedStamp]);

  const loadResult = useCallback(async (stamp?: string | null) => {
    const target = stamp ?? selectedStamp ?? status?.latest_run?.stamp;
    if (!target) return;
    const requestId = ++resultRequestIdRef.current;
    setLoadingResult(true);
    try {
      const res = await fetch(`${API_BASE}/api/xhs/enrich/result?stamp=${encodeURIComponent(target)}`, {
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        handleAccessDenied();
        return;
      }
      if (!res.ok) {
        throw new Error(await readApiError(res, `结果读取失败: ${res.status}`));
      }
      const data = (await res.json()) as ResultResponse;
      if (requestId !== resultRequestIdRef.current) {
        return;
      }
      setResult(data);
      setSelectedStamp(data.run.stamp);
      setError(null);
    } catch (err) {
      if (requestId !== resultRequestIdRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "加载结果失败");
    } finally {
      if (requestId === resultRequestIdRef.current) {
        setLoadingResult(false);
      }
    }
  }, [handleAccessDenied, selectedStamp, status?.latest_run?.stamp]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!selectedStamp) return;
    loadResult(selectedStamp);
  }, [selectedStamp, loadResult]);

  useEffect(() => {
    const interval = status?.state.running ? 3000 : 10000;
    const timer = window.setInterval(() => {
      loadStatus();
    }, interval);
    return () => window.clearInterval(timer);
  }, [status?.state.running, loadStatus]);

  const rows = result?.rows ?? [];
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const bucketFilteredRows = rows.filter((row) => {
    if (bucketFilter === "all") return true;
    if (bucketFilter === "priority") return row.opportunity_bucket === "priority";
    return row.opportunity_bucket === "priority" || row.opportunity_bucket === "watchlist";
  });

  const evidenceFilteredRows = bucketFilteredRows.filter((row) => {
    if (evidenceFilter === "all") return true;
    if (evidenceFilter === "feedback") return Boolean(row.comment_preview || row.author_reply_count || row.feedback_count);
    if (evidenceFilter === "proof") return (row.external_proof?.length ?? 0) > 0;
    if (evidenceFilter === "history") return (row.author_founder_consistency_score ?? 0) > 0;
    return Number(row.investor_fit_score || 0) >= 75;
  });

  const filteredRows = !normalizedQuery
    ? evidenceFilteredRows
    : evidenceFilteredRows.filter((row) =>
        [
          row.title,
          row.desc,
          row.author,
          row.keyword,
          row.summary,
          row.why_it_matters,
          row.outreach_angle,
          row.category,
          row.signal_summary,
          row.risk_flags,
          row.comment_preview,
          row.author_bio,
          row.author_ip_location,
          ...(row.topic_tags || []),
          ...(row.external_proof || []),
          ...((row.author_top_titles as string[] | undefined) || []),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / RESULT_PAGE_SIZE));
  const pageStartIndex = (currentPage - 1) * RESULT_PAGE_SIZE;
  const pageEndIndex = pageStartIndex + RESULT_PAGE_SIZE;
  const visibleRows = filteredRows.slice(pageStartIndex, pageEndIndex);
  const pageRangeStart = filteredRows.length === 0 ? 0 : pageStartIndex + 1;
  const pageRangeEnd = Math.min(pageEndIndex, filteredRows.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedStamp, bucketFilter, evidenceFilter, normalizedQuery]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function togglePanel(panel: "config" | "env" | "log" | "brief") {
    setExpandedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  async function handleRun() {
    setSubmitting(true);
    try {
      const body = {
        mode: form.mode,
        pages: form.pages,
        batch_size: form.batch_size,
        max_results: form.max_results,
        deep_dive_authors: form.deep_dive_authors,
        no_openclaw: form.no_openclaw,
        goal: form.goal.trim(),
        keywords: parseKeywords(form.keywordsText),
      };
      const res = await fetch(`${API_BASE}/api/xhs/enrich/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) {
        handleAccessDenied();
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.state?.last_error || data.detail || "启动任务失败");
      }
      await loadStatus();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  const latestFiles = result?.run.files ?? status?.latest_run?.files;
  const hasRows = (result?.rows.length ?? 0) > 0;
  const latestStamp = status?.latest_run?.stamp ?? null;
  const rowsWithComments = rows.filter((row) => row.comment_preview).length;
  const rowsWithFounderHistory = rows.filter((row) => (row.author_founder_consistency_score ?? 0) > 0).length;
  const uniqueAuthorCount = new Set(rows.map((row) => row.author).filter(Boolean)).size;
  const runProgress = summarizeRunProgress(status);
  const lensCounts = {
    all: bucketFilteredRows.length,
    feedback: bucketFilteredRows.filter((row) => Boolean(row.comment_preview || row.author_reply_count || row.feedback_count)).length,
    proof: bucketFilteredRows.filter((row) => (row.external_proof?.length ?? 0) > 0).length,
    history: bucketFilteredRows.filter((row) => (row.author_founder_consistency_score ?? 0) > 0).length,
    high_fit: bucketFilteredRows.filter((row) => Number(row.investor_fit_score || 0) >= 75).length,
  };
  const currentRunStamp = result?.run.stamp || selectedStamp || latestStamp || "暂无批次";
  const currentRunCreatedAt = result?.run.created_at || status?.latest_run?.created_at || null;
  const labelCounts = result?.summary.label_counts || {};
  const effectiveResultCount =
    (result?.summary.opportunity_counts.priority || 0) + (result?.summary.opportunity_counts.watchlist || 0);
  const visiblePriorityCount = filteredRows.filter((row) => row.opportunity_bucket === "priority").length;
  const commentDensity = rows.length ? Math.round((rowsWithComments / rows.length) * 100) : 0;
  const activeKeywordCount = parseKeywords(form.keywordsText).length;
  const activeBucketLabel =
    bucketFilter === "priority" ? "只看优先" : bucketFilter === "priority_plus" ? "优先 + 观察" : "全部结果";
  const activeEvidenceLabel =
    evidenceFilter === "all"
      ? "全部候选"
      : evidenceFilter === "feedback"
        ? "有用户反馈"
        : evidenceFilter === "proof"
          ? "有站外证据"
        : evidenceFilter === "history"
          ? "有作者连续性"
          : "高匹配 75+";
  const configModeLabel = form.mode === "founder" ? "创始人模式" : "通用模式";
  const configSummaryMetrics = [
    { label: "范围", value: configModeLabel },
    { label: "页数", value: `${form.pages}` },
    { label: "结果上限", value: `${form.max_results}` },
    { label: "深挖作者", value: `${form.deep_dive_authors}` },
  ];
  const objectSummaryLine = filteredRows.length
    ? `优先 ${visiblePriorityCount} 条，评论证据 ${rowsWithComments} 条，作者连续性 ${rowsWithFounderHistory} 条。`
    : "等待结果生成后开始筛选。";
  const exportFileCount = latestFiles ? Object.values(latestFiles).filter(Boolean).length : 0;
  const publishReadyCount = rows.filter(
    (row) => row.opportunity_bucket === "priority" || row.opportunity_bucket === "watchlist",
  ).length;
  const userCardMetrics = [
    { label: "可聚合线索", value: `${publishReadyCount}` },
    { label: "当前批次", value: currentRunStamp === "暂无批次" ? "--" : currentRunStamp },
    { label: "导出文件", value: `${exportFileCount}` },
  ];
  const workspaceProfile = PUBLIC_WORKSPACE_PROFILE;
  const userInitial = workspaceProfile.name.slice(0, 1) || "公";
  const accessStatusTone = publicAccessEnabled ? "status-label-success" : "status-label-warning";
  const accessStatusText = publicAccessEnabled ? "公开直用" : "后端待开放";
  const accessSummaryText = publicAccessEnabled
    ? "当前版本不需要登录，打开后就能直接刷新状态、运行抓取和导出结果。"
    : ACCESS_LOCK_MESSAGE;
  const toggleExpandedRow = (rowId: string) => {
    setExpandedRowId((current) => (current === rowId ? null : rowId));
  };

  return (
    <main className="workspace-stage min-h-screen overflow-hidden bg-transparent text-zinc-800 transition-colors dark:text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.12),transparent_34%)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.01),transparent_28%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1360px] flex-col gap-6 px-4 pt-6 pb-12 md:px-6 xl:px-8">
        <header className="px-1 py-0.5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-100">
                XHS 线索工作台
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                  {currentRunStamp}
                  {" · "}
                  {runProgress.phase}
                  {" · "}
                  {currentRunCreatedAt ? `更新于 ${formatTime(currentRunCreatedAt)}` : "等待结果更新"}
                </p>
                <button
                  onClick={() => setThemeMode((current) => getNextThemeMode(current ?? "auto"))}
                  aria-label={`当前${getThemeModeLabel(activeThemeMode)}主题，点击切换到${getThemeModeLabel(getNextThemeMode(activeThemeMode))}`}
                  title={
                    activeThemeMode === "auto"
                      ? `当前自动主题，按本地时间切换，当前生效为${getThemeModeLabel(resolvedThemeMode)}`
                      : `当前${getThemeModeLabel(activeThemeMode)}主题，点击切换到${getThemeModeLabel(getNextThemeMode(activeThemeMode))}`
                  }
                  className="ui-action-secondary h-8 gap-2 rounded-full px-3 text-[11px] font-medium"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mx-auto h-4 w-4"
                    aria-hidden="true"
                  >
                    {activeThemeMode === "auto" ? (
                      <>
                        <path d="M10 3.4V5" />
                        <path d="M10 15v1.6" />
                        <path d="M4.8 10H3.4" />
                        <path d="M16.6 10h-1.4" />
                        <path d="M6.1 6.1L5 5" />
                        <path d="M15 15l-1.1-1.1" />
                        <path d="M13.9 6.1L15 5" />
                        <path d="M5 15l1.1-1.1" />
                        <path d="M10 6.2a3.8 3.8 0 1 0 0 7.6a3 3 0 0 1 0-7.6Z" />
                      </>
                    ) : activeThemeMode === "dark" ? (
                      <>
                        <circle cx="10" cy="10" r="3.2" />
                        <path d="M10 2.8v2" />
                        <path d="M10 15.2v2" />
                        <path d="M2.8 10h2" />
                        <path d="M15.2 10h2" />
                      </>
                    ) : (
                      <path d="M13.8 13.8A5.5 5.5 0 0 1 6.2 6.2 5.8 5.8 0 1 0 13.8 13.8Z" />
                    )}
                  </svg>
                  <span>{getThemeModeLabel(activeThemeMode)}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  loadStatus();
                }}
                className="ui-button-ghost h-8 rounded-[12px] px-4 text-[12px] font-medium"
              >
                {loadingStatus ? "刷新中" : "刷新状态"}
              </button>
              <button
                onClick={handleRun}
                disabled={submitting || status?.state.running || !status?.run_ready}
                className="ui-button ui-button-primary h-8 rounded-[12px] px-4 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-45"
              >
                {status?.state.running ? "任务运行中" : submitting ? "正在提交" : "重新抓取"}
              </button>
            </div>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[288px_minmax(0,1fr)]">
          <aside className="workspace-sidebar">
            <div className="space-y-5">
            <Panel
              title="工作台概览"
              dense
            >
              <div className="space-y-3">
                <div className="rounded-[16px] border border-[var(--border)] bg-white/55 px-3 py-3 dark:bg-white/[0.03]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[13px] font-semibold text-zinc-900 shadow-[inset_0_0_0_1px_rgba(207,214,222,0.9)] dark:bg-white/10 dark:text-zinc-100 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                      {userInitial}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                          {workspaceProfile.name}
                        </div>
                        <span className={`status-label ${accessStatusTone}`}>
                          {accessStatusText}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                        {accessSummaryText}
                      </div>
                      <div className="mt-1 font-mono text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                        {workspaceProfile.role} · {workspaceProfile.handle} · {workspaceProfile.plan}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="ui-stat-badge">无需登录</span>
                    <span className="ui-stat-badge">直接可用</span>
                    {!publicAccessEnabled ? <span className="ui-stat-badge">请检查后端开放配置</span> : null}
                  </div>
                </div>

                <div className="ui-summary-list">
                  {userCardMetrics.map((item) => (
                    <div key={item.label} className="ui-summary-item">
                      <div className="ui-summary-label">{item.label}</div>
                      <div className="ui-summary-value font-mono">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>
            <section className="status-summary border-b border-black/6 pb-4 dark:border-white/8">
              <div className="flex items-start justify-between gap-3">
                <SectionHeader icon="run" title="运行状态" />
                <div className="flex items-center gap-2">
                  <span
                    className={`status-label ${
                      runProgress.tone === "error"
                        ? "status-label-danger"
                        : runProgress.tone === "running"
                          ? "status-label-warning"
                          : runProgress.tone === "completed"
                            ? "status-label-success"
                            : "status-label-neutral"
                    }`}
                  >
                    {runProgress.phase}
                  </span>
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{Math.round(runProgress.progress)}%</span>
                </div>
              </div>

              <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-200/80 dark:bg-white/8">
                <div
                  className={`h-full rounded-full transition-all ${
                    runProgress.tone === "error"
                      ? "bg-[#9e736d] dark:bg-[#c9a19b]"
                      : runProgress.tone === "completed"
                        ? "bg-[#6d927c] dark:bg-[#7fa18e]"
                        : runProgress.tone === "running"
                          ? "bg-[#7b8796] dark:bg-[#91a0b2]"
                          : "bg-zinc-400"
                  }`}
                  style={{ width: `${runProgress.progress}%` }}
                />
              </div>

              <div className="mt-4 font-mono text-[20px] font-semibold tracking-[-0.03em] text-zinc-950 dark:text-zinc-100">
                {currentRunStamp}
              </div>
              <div className="mt-1 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                {runProgress.detail}
              </div>

              <div className="mt-4">
                <div className="status-main-metric-value">{result?.summary.total_results || 0}</div>
                <div className="status-main-metric-label">结果数</div>
                <div className="status-main-metric-meta">有效线索 {effectiveResultCount}</div>
              </div>

              <div className="status-support-grid mt-4">
                <div className="status-support-metric">
                  <div className="status-support-label">优先级</div>
                  <div className="status-support-value">{result?.summary.opportunity_counts.priority || 0}</div>
                </div>
                <div className="status-support-metric">
                  <div className="status-support-label">评论证据</div>
                  <div className="status-support-value">{rowsWithComments}</div>
                </div>
                <div className="status-support-metric">
                  <div className="status-support-label">连续作者</div>
                  <div className="status-support-value">{rowsWithFounderHistory}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {runProgress.warningCount ? <span className="ui-stat-badge">警告:{runProgress.warningCount}</span> : null}
              </div>

              <div className="mt-3 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {runProgress.lastLine || "等待日志输出"}
              </div>
            </section>

            {error ? <div className="px-1 py-0.5 text-sm text-zinc-700 dark:text-zinc-200">{error}</div> : null}

            <Panel
              title="采集配置"
              dense
              actions={
                <button type="button" onClick={() => togglePanel("config")} className="ui-action-secondary">
                  {expandedPanels.config ? "收起" : "展开"}
                </button>
              }
            >
              {expandedPanels.config ? (
                <div className="styled-scrollbar max-h-[340px] space-y-0 overflow-auto pr-1">
                  <ControlGroup title="扫描预设" hint="先选一套预设，再按下面的模式和参数微调。">
                    <div className="space-y-2">
                      <button
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            pages: 2,
                            batch_size: 10,
                            max_results: 120,
                            deep_dive_authors: 12,
                            keywordsText: wideDiscoveryKeywordPreset,
                            goal:
                              "做一轮偏宽的 founder discovery 扫描，优先找正在解决真实问题、持续公开构建产品、已经出现真实反馈或外部证据的创业者与早期项目，同时过滤课程、流量、社群、卖课和泛创业内容。",
                          }))
                        }
                        className="ui-choice-row"
                      >
                        <div className="ui-choice-row-title">宽扫预设</div>
                        <div className="ui-choice-row-meta">推荐默认档。覆盖 builder、problem-first 和 founder-market 三类查询，默认跑 2 页、120 条上限。</div>
                      </button>
                      <button
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            keywordsText: builderKeywordPreset,
                            goal:
                              "优先寻找在公开环境里持续构建产品、愿意展示迭代过程、已经出现真实反馈的 founder 和 builder。",
                          }))
                        }
                        className="ui-choice-row"
                      >
                        <div className="ui-choice-row-title">产品构建者</div>
                        <div className="ui-choice-row-meta">先找正在做东西的人，重点看 build in public、上线、内测、复盘。</div>
                      </button>
                      <button
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            keywordsText: problemKeywordPreset,
                            goal:
                              "优先寻找围绕具体真实问题启动产品验证的 founder，重点看问题定义、真实场景、用户反馈和评论区共创。",
                          }))
                        }
                        className="ui-choice-row"
                      >
                        <div className="ui-choice-row-title">问题优先</div>
                        <div className="ui-choice-row-meta">先找真实痛点，再看是不是在长出产品与 founder quality。</div>
                      </button>
                      <button
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            keywordsText: founderMarketKeywordPreset,
                            goal:
                              "优先寻找已经暴露出真实增长、客户、融资、招聘或上线信号的早期团队，并压低泛创业叙事和流量内容。",
                          }))
                        }
                        className="ui-choice-row"
                      >
                        <div className="ui-choice-row-title">创始人市场</div>
                        <div className="ui-choice-row-meta">更偏投资人筛选，重点看客户、留存、营收、融资和招聘信号。</div>
                      </button>
                    </div>
                  </ControlGroup>

                  <ControlGroup title="搜索范围" hint="决定这轮抓的是偏创始人线索，还是更泛化的创业与 AI 内容。">
                    <div className="flex rounded-[14px] bg-[var(--surface-muted)] p-1 dark:bg-white/4">
                      <button
                        onClick={() => setForm((current) => ({ ...current, mode: "founder" }))}
                        className={`flex-1 rounded-[12px] px-3 py-2 text-left transition ${
                          form.mode === "founder"
                            ? "bg-white text-zinc-900 shadow-[inset_0_0_0_1px_rgba(207,214,222,0.95)] dark:bg-white/7 dark:text-zinc-100"
                            : "text-zinc-600 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-white/4"
                        }`}
                      >
                        <div className="text-[12px] font-medium">创始人</div>
                        <div className={`mt-1 text-[11px] leading-4 ${form.mode === "founder" ? "text-zinc-500 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                          偏创业者、项目和早期团队线索
                        </div>
                      </button>
                      <button
                        onClick={() => setForm((current) => ({ ...current, mode: "general" }))}
                        className={`flex-1 rounded-[12px] px-3 py-2 text-left transition ${
                          form.mode === "general"
                            ? "bg-white text-zinc-900 shadow-[inset_0_0_0_1px_rgba(207,214,222,0.95)] dark:bg-white/7 dark:text-zinc-100"
                            : "text-zinc-600 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-white/4"
                        }`}
                      >
                        <div className="text-[12px] font-medium">通用</div>
                        <div className={`mt-1 text-[11px] leading-4 ${form.mode === "general" ? "text-zinc-500 dark:text-zinc-300" : "text-zinc-500 dark:text-zinc-400"}`}>
                          保留通用 AI / 投资 / VC 关键词
                        </div>
                      </button>
                    </div>
                  </ControlGroup>

                  <ControlGroup title="采集参数" hint="控制翻页深度、每批处理量和最终结果上限。">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-zinc-500 dark:text-zinc-400">页数</span>
                        <input
                          type="number"
                          min={1}
                          value={form.pages}
                          onChange={(e) => setForm((current) => ({ ...current, pages: Number(e.target.value) || 1 }))}
                          className="ui-field w-full rounded-[12px] px-3 py-2 text-[13px] text-zinc-700 outline-none dark:text-zinc-100"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-zinc-500 dark:text-zinc-400">每批数量</span>
                        <input
                          type="number"
                          min={1}
                          value={form.batch_size}
                          onChange={(e) =>
                            setForm((current) => ({ ...current, batch_size: Number(e.target.value) || 1 }))
                          }
                          className="ui-field w-full rounded-[12px] px-3 py-2 text-[13px] text-zinc-700 outline-none dark:text-zinc-100"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-zinc-500 dark:text-zinc-400">结果上限</span>
                        <input
                          type="number"
                          min={0}
                          value={form.max_results}
                          onChange={(e) =>
                            setForm((current) => ({ ...current, max_results: Number(e.target.value) || 0 }))
                          }
                          className="ui-field w-full rounded-[12px] px-3 py-2 text-[13px] text-zinc-700 outline-none dark:text-zinc-100"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-zinc-500 dark:text-zinc-400">深挖作者</span>
                        <input
                          type="number"
                          min={0}
                          value={form.deep_dive_authors}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              deep_dive_authors: Number(e.target.value) || 0,
                            }))
                          }
                          className="ui-field w-full rounded-[12px] px-3 py-2 text-[13px] text-zinc-700 outline-none dark:text-zinc-100"
                        />
                      </label>
                    </div>
                  </ControlGroup>

                  <ControlGroup title="关键词池" hint="这里决定本轮抓取的语义范围，尽量保持关键词短而准。">
                    <label className="block">
                      <textarea
                        rows={5}
                        value={form.keywordsText}
                        onChange={(e) => setForm((current) => ({ ...current, keywordsText: e.target.value }))}
                        placeholder="留空则使用脚本默认关键词。支持换行或逗号分隔。"
                        className="ui-field w-full rounded-[14px] px-3 py-2 text-[13px] leading-5 text-zinc-700 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                      />
                    </label>
                  </ControlGroup>

                  <ControlGroup title="命令说明" hint="补充本轮目标和执行策略，解释性文字尽量短。">
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-zinc-500 dark:text-zinc-400">本轮目标</span>
                        <textarea
                          rows={3}
                          value={form.goal}
                          onChange={(e) => setForm((current) => ({ ...current, goal: e.target.value }))}
                          placeholder="留空则使用脚本预设目标。"
                          className="ui-field w-full rounded-[14px] px-3 py-2 text-[13px] leading-5 text-zinc-700 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                        />
                      </label>
                      <label className="flex items-start gap-2.5 px-1 py-1.5">
                        <input
                          type="checkbox"
                          checked={!form.no_openclaw}
                          onChange={(e) => setForm((current) => ({ ...current, no_openclaw: !e.target.checked }))}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 bg-transparent accent-zinc-800 dark:border-zinc-600 dark:accent-zinc-100"
                        />
                        <div>
                          <div className="text-[12px] text-zinc-800 dark:text-zinc-100">启用 OpenClaw 增强（可选）</div>
                          <div className="mt-0.5 text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                            默认只用启发式规则，保证首次运行更稳。如果你本机已经安装 `openclaw`，打开后会补充
                            `summary`、`why it matters`、`outreach angle` 等增强字段；未安装时系统会自动回退。
                          </div>
                        </div>
                      </label>
                    </div>
                  </ControlGroup>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="ui-summary-list">
                    {configSummaryMetrics.map((item) => (
                      <div key={item.label} className="ui-summary-item">
                        <div className="ui-summary-label">{item.label}</div>
                        <div className="ui-summary-value">{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="ui-stat-badge">关键词:{activeKeywordCount}</span>
                      <span className="ui-stat-badge">{form.no_openclaw ? "默认启发式" : "启用 OpenClaw 增强"}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-zinc-600 dark:text-zinc-300 clamp-2">
                      {form.goal}
                    </p>
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="后端环境"
              dense
              actions={
                <button type="button" onClick={() => togglePanel("env")} className="ui-action-secondary">
                  {expandedPanels.env ? "收起" : "展开"}
                </button>
              }
            >
              {expandedPanels.env ? (
                <div className="space-y-2.5 text-sm text-zinc-600 dark:text-zinc-300">
                  <div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">脚本</div>
                    <div className="mt-1 break-all font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300">{status?.script_path || "..."}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">输出目录</div>
                    <div className="mt-1 break-all font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300">{status?.output_dir || "..."}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">xhs CLI</div>
                    <div className="mt-1 break-all font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                      {status?.dependencies.xhs.path || "未检测到"}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                      {status?.dependencies.xhs.status || "等待检测"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">OpenClaw</div>
                    <div className="mt-1 break-all font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                      {status?.dependencies.openclaw.path || "未检测到"}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                      {status?.dependencies.openclaw.status || "等待检测"}
                    </div>
                  </div>
                  <div className="px-1 py-1 font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300">
                    {status?.run_ready
                      ? "真实抓取依赖已就绪，可直接运行。"
                      : status?.run_blockers.length
                        ? `当前还缺：${status.run_blockers.join("、")}`
                        : status?.script_exists
                          ? "依赖检测中。"
                          : "脚本路径不存在。先修正后端环境变量 XHS_ENRICH_SCRIPT 或把脚本放回默认位置。"}
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 px-1">
                  <div className="flex items-center gap-2">
                    <span className={`status-label ${status?.run_ready ? "status-label-success" : "status-label-danger"}`}>
                      {status?.run_ready ? "抓取可用" : "待补依赖"}
                    </span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {status?.dependencies.xhs.logged_in ? "xhs 已登录" : "需先执行 xhs login"}
                    </span>
                  </div>
                  <div className="line-clamp-2 font-mono text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
                    {status?.run_blockers.length ? status.run_blockers.join(" · ") : status?.output_dir || status?.script_path || "..."}
                  </div>
                </div>
              )}
            </Panel>

            <Panel
              title="任务日志"
              dense
              actions={
                <button
                  type="button"
                  onClick={() => togglePanel("log")}
                  className="ui-action-secondary"
                >
                  {expandedPanels.log ? "收起" : "展开"}
                </button>
              }
            >
              {status?.state.last_error ? (
                <div className="mb-3 rounded-[14px] border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-[11px] leading-5 text-rose-700 dark:border-rose-300/10 dark:bg-rose-500/8 dark:text-rose-200">
                  {status.state.last_error}
                </div>
              ) : null}
              {status?.state.runtime_notes?.length ? (
                <div className="mb-3 rounded-[14px] border border-black/8 bg-black/[0.03] px-3 py-2 text-[11px] leading-5 text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200">
                  {status.state.runtime_notes.join(" ")}
                </div>
              ) : null}
              <pre
                className={`ui-code-panel styled-scrollbar whitespace-pre-wrap rounded-[14px] p-3.5 font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300 ${
                  expandedPanels.log ? "max-h-[320px] overflow-auto" : "max-h-[72px] overflow-hidden"
                }`}
              >
                {status?.state.last_stdout || (status?.state.running ? "任务已启动，等待第一条日志..." : "暂无运行日志")}
              </pre>
            </Panel>

            <Panel
              title="研究简报"
              dense
              actions={
                <button
                  type="button"
                  onClick={() => togglePanel("brief")}
                  className="ui-action-secondary"
                >
                  {expandedPanels.brief ? "收起" : "展开"}
                </button>
              }
            >
              <pre
                className={`ui-code-panel styled-scrollbar whitespace-pre-wrap rounded-[16px] p-3.5 font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300 ${
                  expandedPanels.brief ? "max-h-[320px] overflow-auto" : "max-h-[110px] overflow-hidden"
                }`}
              >
                {loadingResult ? "加载中..." : result?.brief_markdown || "暂无简报内容"}
              </pre>
            </Panel>
            </div>
          </aside>

          <div className="workspace-main min-w-0">
            <Panel title="结果列表">
              <div className="space-y-4 border-b border-black/6 pb-4 dark:border-white/8">
                <div className="result-object-panel">
                  <div className="result-object-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="result-object-kicker">当前批次</div>
                        <div className="result-object-title">{currentRunStamp}</div>
                      </div>
                      <span
                        className={`status-label ${
                          runProgress.tone === "error"
                            ? "status-label-danger"
                            : runProgress.tone === "running"
                              ? "status-label-warning"
                              : runProgress.tone === "completed"
                                ? "status-label-success"
                                : "status-label-neutral"
                        }`}
                      >
                        {runProgress.phase}
                      </span>
                    </div>
                    <div className="result-object-meta">
                      {currentRunCreatedAt ? `更新于 ${formatTime(currentRunCreatedAt)}` : "等待结果生成"}
                      {" · "}
                      {activeBucketLabel}
                      {" · "}
                      {activeEvidenceLabel}
                    </div>
                    <p className="result-object-summary">
                      {objectSummaryLine}
                    </p>
                  </div>

                  <div className="result-object-stats">
                    <div className="result-object-metric">
                      <div className="result-object-metric-label">结果数</div>
                      <div className="result-object-metric-value">{filteredRows.length}</div>
                      <div className="result-object-metric-meta">总计 {rows.length}</div>
                    </div>
                    <div className="result-object-metric">
                      <div className="result-object-metric-label">优先线索</div>
                      <div className="result-object-metric-value">{visiblePriorityCount}</div>
                      <div className="result-object-metric-meta">观察 {result?.summary.opportunity_counts.watchlist || 0}</div>
                    </div>
                    <div className="result-object-metric">
                      <div className="result-object-metric-label">评论密度</div>
                      <div className="result-object-metric-value">{commentDensity}%</div>
                      <div className="result-object-metric-meta">评论证据 {rowsWithComments}</div>
                    </div>
                    <div className="result-object-metric">
                      <div className="result-object-metric-label">活跃作者</div>
                      <div className="result-object-metric-value">{uniqueAuthorCount}</div>
                      <div className="result-object-metric-meta">连续作者 {rowsWithFounderHistory}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 border-b border-black/6 pb-4 dark:border-white/8">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {[
                        { key: "priority", label: "只看优先" },
                        { key: "priority_plus", label: "优先 + 观察" },
                        { key: "all", label: "全部结果" },
                      ].map((item) => (
                        <button
                          type="button"
                          key={item.key}
                          onClick={() => setBucketFilter(item.key as "priority" | "priority_plus" | "all")}
                          className={`ui-tab ${bucketFilter === item.key ? "ui-tab-active" : ""}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="ui-stat-badge">命中:{filteredRows.length}</span>
                      {Object.entries(labelCounts).map(([label, count]) => (
                        <span key={label} className="ui-stat-badge">
                          {label}:{count}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">条件过滤</span>
                    {[
                      { key: "all", label: "全部候选", count: lensCounts.all },
                      { key: "feedback", label: "有用户反馈", count: lensCounts.feedback },
                      { key: "proof", label: "有站外证据", count: lensCounts.proof },
                      { key: "history", label: "有作者连续性", count: lensCounts.history },
                      { key: "high_fit", label: "高匹配 75+", count: lensCounts.high_fit },
                    ].map((item) => (
                      <button
                        type="button"
                        key={item.key}
                        onClick={() =>
                          setEvidenceFilter(item.key as "all" | "feedback" | "proof" | "history" | "high_fit")
                        }
                        className={`ui-filter-toggle ${evidenceFilter === item.key ? "ui-filter-toggle-active" : ""}`}
                      >
                        {item.label} {item.count}
                      </button>
                    ))}
                    <span className="ui-stat-badge">{activeEvidenceLabel}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <UtilityHeader
                      icon="history"
                      title="最近批次"
                      meta={
                        <span className="ui-stat-badge">
                          最近 {status?.recent_runs.length || 0} 批
                        </span>
                      }
                    />
                    <div className="batch-switcher styled-scrollbar mt-2">
                      {(status?.recent_runs || []).map((run) => {
                        const active = run.stamp === selectedStamp;
                        return (
                          <button
                            key={run.stamp}
                            onClick={() => setSelectedStamp(run.stamp)}
                            className={`batch-switch-item ${active ? "batch-switch-item-active" : ""}`}
                          >
                            <div className="batch-switch-title truncate font-mono">{run.stamp}</div>
                            <div className="batch-switch-meta">{formatTime(run.created_at)}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.92fr)_minmax(0,1.08fr)]">
                    <div className="ui-panel-soft utility-strip-panel rounded-[18px] px-3 py-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                      <div className="mb-2">
                        <UtilityHeader icon="export" title="导出文件" />
                      </div>
                      <div className="space-y-1.5">
                        {(["json", "brief", "csv", "deepdive"] as const).map((kind) => {
                          const file = latestFiles?.[kind];
                          if (!file) return null;
                          return (
                            <a
                              key={kind}
                              href={file.url}
                              className="ui-file-row"
                            >
                              <span className="ui-file-badge">{kind}</span>
                              <span className="ui-file-name font-mono">{file.name}</span>
                              <span className="ui-file-action">下载</span>
                            </a>
                          );
                        })}
                        {!latestFiles ? (
                          <div className="px-1 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">当前批次还没有导出文件。</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="ui-panel-soft utility-strip-panel rounded-[18px] px-3 py-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                      <div className="mb-2">
                        <UtilityHeader icon="results" title="快速筛选" />
                      </div>
                      <div className="space-y-2">
                        <label className="ui-search-shell">
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="ui-search-icon h-4 w-4"
                            aria-hidden="true"
                          >
                            <circle cx="9" cy="9" r="4.5" />
                            <path d="M12.5 12.5L16 16" />
                          </svg>
                          <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="筛关键词 / 作者 / 标签"
                            className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-700 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                          />
                          {query ? (
                            <button
                              type="button"
                              onClick={() => setQuery("")}
                              className="text-[11px] text-zinc-400 transition hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200"
                            >
                              清空
                            </button>
                          ) : null}
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" className="ui-filter-toggle" onClick={() => setEvidenceFilter("feedback")}>
                            有反馈
                          </button>
                          <button type="button" className="ui-filter-toggle" onClick={() => setEvidenceFilter("proof")}>
                            有站外证据
                          </button>
                          <button type="button" className="ui-filter-toggle" onClick={() => setEvidenceFilter("high_fit")}>
                            高匹配 75+
                          </button>
                          <button
                            type="button"
                            className="ui-filter-toggle"
                            onClick={() => {
                              setQuery("");
                              setBucketFilter("all");
                              setEvidenceFilter("all");
                            }}
                          >
                            清空
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {!hasRows && !loadingResult ? (
                <div className="ui-empty-state rounded-[16px] px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  还没有可展示的结果。先运行一次，或从右上角刷新最近导出。
                </div>
              ) : null}
              {hasRows && filteredRows.length === 0 ? (
                <div className="ui-empty-state rounded-[16px] px-5 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  当前筛选条件过严，没有命中结果。可以切到“全部结果”或降低查询约束。
                </div>
              ) : null}

              {filteredRows.length ? (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-black/6 px-1 pb-3 pt-1 text-[11px] text-zinc-600 dark:border-white/8 dark:text-zinc-300">
                  <div className="text-zinc-500 dark:text-zinc-400">
                    第 {currentPage} / {totalPages} 页
                    {" · "}
                    显示 {pageRangeStart}-{pageRangeEnd} / {filteredRows.length}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={currentPage === 1}
                      className="ui-action-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      上一页
                    </button>
                    {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                      <button
                        type="button"
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`ui-tab ${currentPage === page ? "ui-tab-active" : ""}`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      disabled={currentPage === totalPages}
                      className="ui-action-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="divide-y divide-stone-200/60 dark:divide-white/6">
                {visibleRows.map((row) => {
                  const fitScore = Number(row.investor_fit_score || 0);
                  const label = row.final_label || row.rule_label || "未知";
                  const founderConsistency = Number(row.author_founder_consistency_score || 0);
                  const proofSignals = row.external_proof || [];
                  const topicTags = (row.topic_tags || []).slice(0, 4);
                  const cleanNoiseReason = cleanRiskText(row.noise_reason);
                  const cleanRiskFlags = cleanRiskText(row.risk_flags);
                  const pinnedExpanded = expandedRowId === row.note_id;
                  const hoverExpanded = hoverPreviewEnabled && hoveredRowId === row.note_id;
                  const expanded = hoverExpanded || (!hoveredRowId && pinnedExpanded);
                  const metaLine = joinCompact([
                    row.author || "未知作者",
                    row.publish_time || "未知时间",
                    fitScore ? `匹配 ${fitScore}` : null,
                    row.keyword ? `来源 ${row.keyword}` : row.category ? `来源 ${row.category}` : null,
                  ]);
                  const compactPreview =
                    [
                      row.summary,
                      row.why_it_matters,
                      row.outreach_angle,
                      row.signal_summary,
                      row.comment_preview,
                      row.desc,
                      cleanRiskFlags,
                      cleanNoiseReason,
                    ].find((item) => item?.trim()) || "无额外摘要";
                  const displayTags = [
                    row.comment_preview ? { kind: "proof" as const, text: "有反馈" } : null,
                    founderConsistency > 0 ? { kind: "proof" as const, text: `连续性 ${founderConsistency}` } : null,
                    ...proofSignals.slice(0, 2).map((proof) => ({ kind: "proof" as const, text: formatProof(proof) })),
                    ...topicTags.map((tag) => ({ kind: "topic" as const, text: `#${tag}` })),
                  ].filter(
                    (
                      tag,
                    ): tag is {
                      kind: "proof" | "topic";
                      text: string;
                    } => Boolean(tag),
                  );
                  const visibleTags = displayTags.slice(0, 6);
                  const hiddenTagCount = displayTags.length - visibleTags.length;
                  const bucketDotClass =
                    row.opportunity_bucket === "priority"
                      ? "priority"
                      : row.opportunity_bucket === "watchlist"
                        ? "watchlist"
                        : "";
                  return (
                    <article
                      key={row.note_id}
                      className={`ui-result-card group ${expanded ? "result-row-selected" : ""}`}
                      onMouseEnter={hoverPreviewEnabled ? () => setHoveredRowId(row.note_id) : undefined}
                      onMouseLeave={
                        hoverPreviewEnabled
                          ? () => setHoveredRowId((current) => (current === row.note_id ? null : current))
                          : undefined
                      }
                    >
                      <div className="result-row">
                        <button
                          type="button"
                          onClick={() => {
                            if (hoverExpanded && !pinnedExpanded) {
                              setExpandedRowId(row.note_id);
                              return;
                            }
                            toggleExpandedRow(row.note_id);
                          }}
                          aria-expanded={expanded}
                          className="result-row-main rounded-[14px] px-0 text-left transition hover:bg-white/20 dark:hover:bg-white/3"
                        >
                          <div className="result-row-titlebar">
                            <span className={`result-row-status-dot ${bucketDotClass}`} />
                            <h3 className="result-row-title">{row.title || "(无标题笔记)"}</h3>
                            {label !== "未知" ? (
                              <span className="result-inline-status result-inline-status-quality">{label}</span>
                            ) : null}
                            {row.opportunity_bucket ? (
                              <span className="result-inline-status result-inline-status-bucket">{displayBucket(row.opportunity_bucket)}</span>
                            ) : null}
                          </div>
                          <div className="result-row-meta">{metaLine}</div>
                          <div className="result-row-summary clamp-2">{compactPreview}</div>
                          <div className="result-row-tags">
                            {visibleTags.map((tag) => (
                              <span
                                key={`${row.note_id}-${tag.kind}-${tag.text}`}
                                className={`result-tag ${
                                  tag.kind === "topic"
                                    ? "result-tag-topic"
                                    : tag.kind === "proof"
                                      ? "result-tag-proof"
                                      : "result-tag-quality"
                                }`}
                              >
                                {tag.text}
                              </span>
                            ))}
                            {hiddenTagCount > 0 ? (
                              <span className="result-tag result-tag-proof">+{hiddenTagCount}</span>
                            ) : null}
                          </div>
                        </button>

                        <div className="result-row-actions">
                          <button
                            type="button"
                            onClick={() => {
                              if (hoverExpanded && !pinnedExpanded) {
                                setExpandedRowId(row.note_id);
                                return;
                              }
                              toggleExpandedRow(row.note_id);
                            }}
                            className="ui-action-primary-soft h-7 px-3 text-[11px] font-medium"
                          >
                            {pinnedExpanded ? "收起详情" : hoverExpanded ? "固定详情" : "查看详情"}
                          </button>
                          {row.url ? (
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ui-action-secondary h-7"
                            >
                              打开原帖
                            </a>
                          ) : null}
                        </div>

                        {expanded ? (
                          <div className="col-span-full grid gap-4 border-t border-black/6 pt-3 dark:border-white/8 xl:grid-cols-[minmax(0,1.55fr)_minmax(240px,0.82fr)]">
                            <div className="space-y-3">
                              {row.summary ? <p className="text-[13px] leading-5 text-zinc-700 dark:text-zinc-200">{row.summary}</p> : null}
                              {row.why_it_matters ? (
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">为什么值得看</div>
                                  <p className="text-[13px] leading-5 text-zinc-700 dark:text-zinc-200">{row.why_it_matters}</p>
                                </div>
                              ) : null}
                              {row.outreach_angle ? (
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">触达角度</div>
                                  <p className="text-[13px] leading-5 text-zinc-700 dark:text-zinc-200">{row.outreach_angle}</p>
                                </div>
                              ) : null}
                              {row.comment_preview ? (
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">用户反馈</div>
                                  <p className="text-[13px] leading-5 text-zinc-700 dark:text-zinc-200">{row.comment_preview}</p>
                                </div>
                              ) : null}
                              {row.desc ? (
                                <p className="max-h-[6rem] overflow-hidden text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">{row.desc}</p>
                              ) : null}
                            </div>

                            <div className="space-y-3">
                              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">证据</div>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {proofSignals.length ? (
                                      proofSignals.map((proof) => (
                                        <span
                                          key={proof}
                                          className={`rounded-full px-2 py-0.5 text-[11px] ${proofTone(proof)}`}
                                        >
                                          {formatProof(proof)}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500">暂无站外证据</span>
                                    )}
                                  </div>
                                  {topicTags.length ? (
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {topicTags.map((tag) => (
                                        <span
                                          key={tag}
                                          className="ui-chip rounded-full px-2 py-0.5 text-[11px] text-zinc-600 dark:text-zinc-300"
                                        >
                                          #{tag}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">作者质量</div>
                                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                                    <span>连续性 {founderConsistency}</span>
                                    {row.author_fans ? <span>粉丝 {row.author_fans}</span> : null}
                                    {row.author_founderish_post_count ? (
                                      <span>创业相关 {row.author_founderish_post_count}</span>
                                    ) : null}
                                    {row.author_reply_count ? <span>作者回复 {row.author_reply_count}</span> : null}
                                  </div>
                                  {row.author_bio ? (
                                    <p className="mt-1.5 max-h-[3.5rem] overflow-hidden text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{row.author_bio}</p>
                                  ) : null}
                                </div>
                              </div>

                              {row.signal_summary ? (
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">信号判断</div>
                                  <p className="text-[11px] leading-5 text-zinc-700 dark:text-zinc-200">{row.signal_summary}</p>
                                </div>
                              ) : null}

                              {row.author_top_titles?.length ? (
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">作者近期标题</div>
                                  <div className="mt-1.5 space-y-1 text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
                                    {row.author_top_titles.slice(0, 3).map((title) => (
                                      <div key={title}>{title}</div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {cleanNoiseReason || cleanRiskFlags ? (
                                <div className="space-y-1">
                                  <div className="text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500">风险提示</div>
                                  {cleanNoiseReason ? (
                                    <p className="text-[11px] leading-5 text-zinc-700 dark:text-zinc-200">{cleanNoiseReason}</p>
                                  ) : null}
                                  {cleanRiskFlags ? (
                                    <p className="text-[11px] leading-5 text-zinc-700 dark:text-zinc-200">{cleanRiskFlags}</p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              {filteredRows.length > RESULT_PAGE_SIZE ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/6 px-1 pt-3 text-[11px] text-zinc-600 dark:border-white/8 dark:text-zinc-300">
                  <div className="text-zinc-500 dark:text-zinc-400">
                    第 {currentPage} / {totalPages} 页
                    {" · "}
                    显示 {pageRangeStart}-{pageRangeEnd} / {filteredRows.length}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={currentPage === 1}
                      className="ui-action-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      上一页
                    </button>
                    {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                      <button
                        type="button"
                        key={`bottom-${page}`}
                        onClick={() => setCurrentPage(page)}
                        className={`ui-tab ${currentPage === page ? "ui-tab-active" : ""}`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      disabled={currentPage === totalPages}
                      className="ui-action-secondary disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}

            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}
