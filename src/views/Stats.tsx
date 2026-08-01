import { useMemo, useState } from "react";
import { useStore } from "../store";
import { BarChart, DonutChart } from "../components/Charts";
import WordCloud from "../components/WordCloud";
import ProgressBar from "../components/ProgressBar";
import { BossError, fetchJobDetail, searchJobs } from "../api/boss";
import {
  annualMidpointWan,
  countBy,
  countMulti,
  extractWords,
  salaryBucketLabel,
  topN,
} from "../utils";
import { STOPWORDS } from "../constants";
import type { Job } from "../types";

export default function Stats() {
  const {
    sessionJobs, addSessionJobs, clearSessionJobs, lastFilters, details,
    cacheDetail, toast,
  } = useStore();
  const jobs = useMemo(() => [...sessionJobs.values()], [sessionJobs]);

  const [fetchN, setFetchN] = useState(3);
  const [fetching, setFetching] = useState(false);
  const [fetchPage, setFetchPage] = useState(0);
  const [cloudJobId, setCloudJobId] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);

  // ---- 聚合统计 ----
  const stats = useMemo(() => {
    const salaries = jobs
      .map((j) => annualMidpointWan(j.salaryDesc || ""))
      .filter((v): v is number => v !== null);
    const avgSalary =
      salaries.length > 0
        ? salaries.reduce((a, b) => a + b, 0) / salaries.length
        : null;
    const skillCounts = countMulti(jobs.map((j) => [...(j.skills || []), ...(j.jobLabels || [])]));
    return {
      total: jobs.length,
      avgSalary,
      cityCount: new Set(jobs.map((j) => j.cityName).filter(Boolean)).size,
      skillCount: skillCounts.size,
      salaryDist: topN(
        countBy(jobs, (j) => salaryBucketLabel(j.salaryDesc || "")),
        10
      ),
      // 保持固定桶顺序
      expDist: [...countBy(jobs, (j) => j.jobExperience).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
      degreeDist: [...countBy(jobs, (j) => j.jobDegree).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
      cityDist: [...countBy(jobs, (j) => j.cityName).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, value]) => ({ label, value })),
      areaDist: [...countBy(jobs, (j) => (j.areaDistrict ? `${j.cityName}·${j.areaDistrict}` : null)).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([label, value]) => ({ label, value })),
      scaleDist: [...countBy(jobs, (j) => j.brandScaleName).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
      stageDist: [...countBy(jobs, (j) => j.brandStageName).entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({ label, value })),
      skillTop: topN(skillCounts, 30),
      companyTop: topN(countBy(jobs, (j) => j.brandName), 20),
      welfareTop: topN(countMulti(jobs.map((j) => j.welfareList || [])), 20),
    };
  }, [jobs]);

  // 薪资桶按固定顺序排列
  const salaryDistOrdered = useMemo(() => {
    const order = ["10万以下", "10-20万", "20-30万", "30-50万", "50-80万", "80-120万", "120万以上"];
    const m = new Map(stats.salaryDist.map((d) => [d.text, d.count]));
    return order
      .filter((l) => m.has(l))
      .map((label) => ({ label, value: m.get(label) || 0 }));
  }, [stats.salaryDist]);

  // ---- 一键抓取前 N 页 ----
  const crawl = async () => {
    if (!lastFilters) {
      toast("请先在「职位搜索」执行一次搜索，抓取将沿用该筛选条件", "warning");
      return;
    }
    setFetching(true);
    setFetchPage(0);
    let added = 0;
    try {
      for (let p = 1; p <= fetchN; p++) {
        setFetchPage(p);
        const list = await searchJobs(lastFilters, p, 30);
        addSessionJobs(list);
        added += list.length;
        if (list.length === 0) break;
        if (p < fetchN) await new Promise((r) => setTimeout(r, 1500));
      }
      toast(`抓取完成，新增/更新 ${added} 条职位`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), e instanceof BossError && e.kind === "risk" ? "warning" : "error");
    } finally {
      setFetching(false);
    }
  };

  // ---- 单职位 JD 词云 ----
  const [cloudError, setCloudError] = useState<string | null>(null);
  const cloudJob: Job | undefined = jobs.find((j) => j.encryptJobId === cloudJobId);
  const cloudWords = useMemo(() => {
    if (!cloudJobId) return [];
    const d = details.get(cloudJobId);
    if (!d) return [];
    return topN(extractWords(d.jd, STOPWORDS), 60);
  }, [cloudJobId, details]);

  const loadCloud = async () => {
    if (!cloudJob) return;
    setCloudError(null);
    if (details.has(cloudJob.encryptJobId)) return;
    setCloudLoading(true);
    try {
      const d = await fetchJobDetail(cloudJob);
      cacheDetail(cloudJob.encryptJobId, d);
    } catch (e) {
      setCloudError(e instanceof Error ? e.message : String(e));
    } finally {
      setCloudLoading(false);
    }
  };

  return (
    <div className="view stats-view">
      <div className="card stats-toolbar">
        <div>
          <div className="card-title">数据统计</div>
          <div className="form-hint">
            基于本次会话累积的职位数据（搜索 + 抓取自动累积，当前 {jobs.length} 条）
            {lastFilters
              ? `；当前抓取条件：「${lastFilters.query || "全部"}」· ${lastFilters.cityName}`
              : "；尚未搜索过"}
          </div>
        </div>
        <div className="stats-crawl">
          <span>抓取前</span>
          <input
            className="input input-num"
            type="number"
            min={1}
            max={10}
            value={fetchN}
            onChange={(e) => setFetchN(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
          />
          <span>页</span>
          <button className="btn btn-primary btn-sm" disabled={fetching} onClick={() => void crawl()}>
            {fetching ? `抓取第 ${fetchPage} 页…` : "一键抓取"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={fetching || jobs.length === 0} onClick={clearSessionJobs}>
            清空数据
          </button>
        </div>
        {fetching && <ProgressBar current={fetchPage} total={fetchN} />}
      </div>

      {jobs.length === 0 ? (
        <div className="empty-block">
          <div className="empty-icon">◔</div>
          <div>暂无数据</div>
          <div className="empty-sub">到「职位搜索」搜索职位，或在上方一键抓取多页数据</div>
        </div>
      ) : (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-num">{stats.total}</div>
              <div className="summary-label">岗位总数</div>
            </div>
            <div className="summary-card">
              <div className="summary-num">
                {stats.avgSalary !== null ? `${stats.avgSalary.toFixed(1)}万` : "—"}
              </div>
              <div className="summary-label">平均年薪（中位估计）</div>
            </div>
            <div className="summary-card">
              <div className="summary-num">{stats.cityCount}</div>
              <div className="summary-label">覆盖城市</div>
            </div>
            <div className="summary-card">
              <div className="summary-num">{stats.skillCount}</div>
              <div className="summary-label">技能词数量</div>
            </div>
          </div>

          <div className="chart-grid">
            <BarChart title="薪资区间分布（年薪）" data={salaryDistOrdered} unit=" 岗" />
            <DonutChart title="经验要求分布" data={stats.expDist} />
            <DonutChart title="学历要求分布" data={stats.degreeDist} />
            <BarChart title="城市分布 Top 10" data={stats.cityDist} />
            <BarChart title="区域分布 Top 10" data={stats.areaDist} />
            <DonutChart title="公司规模分布" data={stats.scaleDist} />
            <DonutChart title="融资阶段分布" data={stats.stageDist} />
            <BarChart title="高频招聘公司 Top 20" data={stats.companyTop.map((c) => ({ label: c.text, value: c.count }))} />
            <BarChart title="高频技能 / 标签 Top 30" data={stats.skillTop.map((c) => ({ label: c.text, value: c.count }))} />
            <BarChart title="热门福利词 Top 20" data={stats.welfareTop.map((c) => ({ label: c.text, value: c.count }))} />
          </div>

          <div className="card">
            <div className="card-title">全局技能词云（Top 60）</div>
            <WordCloud words={stats.skillTop} maxWords={60} emptyText="暂无技能数据（职位卡片未返回技能标签）" />
          </div>

          <div className="card">
            <div className="card-title">单职位 JD 词云</div>
            <div className="cloud-picker-row">
              <select
                className="input cloud-picker"
                value={cloudJobId}
                onChange={(e) => setCloudJobId(e.target.value)}
              >
                <option value="">选择一个职位…</option>
                {jobs.slice(0, 200).map((j) => (
                  <option key={j.encryptJobId} value={j.encryptJobId}>
                    {j.jobName} @ {j.brandName}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                disabled={!cloudJob || cloudLoading}
                onClick={() => void loadCloud()}
              >
                {cloudLoading
                  ? "抓取 JD 中…"
                  : details.has(cloudJobId)
                    ? "已缓存，直接生成"
                    : "抓取 JD 并生成词云"}
              </button>
            </div>
            {cloudError && <div className="alert alert-error">{cloudError}</div>}
            {cloudJobId && details.has(cloudJobId) && (
              <WordCloud words={cloudWords} maxWords={60} emptyText="未能从 JD 中提取到有效词" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
