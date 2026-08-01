import type { Job } from "../types";
import { useStore } from "../store";

export default function JobCard(props: {
  job: Job;
  active: boolean;
  delivered?: boolean;
  onOpen: (job: Job) => void;
  onGreet: (job: Job) => void;
  greeting: boolean;
}) {
  const { job } = props;
  const { selected, toggleSelect, queue, addToQueue } = useStore();
  const checked = selected.has(job.encryptJobId);
  const inQueue = queue.some((j) => j.encryptJobId === job.encryptJobId);
  const loc = [job.cityName, job.areaDistrict, job.businessDistrict]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`job-card ${props.active ? "active" : ""}`}
      onClick={() => props.onOpen(job)}
    >
      <div className="job-card-top">
        <label className="job-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleSelect(job.encryptJobId)}
          />
        </label>
        <div className="job-title-wrap">
          <div className="job-title">
            {job.jobName}
            {props.delivered && <span className="delivered-badge">已投递</span>}
          </div>
          <div className="job-company">{job.brandName}</div>
        </div>
        <div className="job-salary">{job.salaryDesc || "薪资面议"}</div>
      </div>
      <div className="job-meta">
        <span>{loc || job.cityName}</span>
        {job.jobExperience && <span className="chip">{job.jobExperience}</span>}
        {job.jobDegree && <span className="chip">{job.jobDegree}</span>}
        {(job.bossOnline || job.activeTimeDesc) && (
          <span className="online-badge">
            <span className="online-dot" />
            {job.bossOnline ? "在线" : job.activeTimeDesc}
          </span>
        )}
      </div>
      <div className="job-meta job-meta-sub">
        {[job.brandScaleName, job.brandStageName, job.brandIndustry]
          .filter(Boolean)
          .join(" · ")}
      </div>
      {(job.jobLabels?.length || job.skills?.length) && (
        <div className="job-tags">
          {[...(job.skills || []), ...(job.jobLabels || [])]
            .slice(0, 6)
            .map((t, i) => (
              <span key={`${t}-${i}`} className="tag">
                {t}
              </span>
            ))}
        </div>
      )}
      {!!job.welfareList?.length && (
        <div className="job-welfare">{job.welfareList.slice(0, 6).join(" · ")}</div>
      )}
      <div className="job-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="btn btn-primary btn-sm"
          disabled={props.greeting}
          onClick={() => props.onGreet(job)}
        >
          {props.greeting ? "打招呼中…" : "打招呼"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={inQueue}
          onClick={() => addToQueue([job])}
        >
          {inQueue ? "已在队列" : "加入投递队列"}
        </button>
      </div>
    </div>
  );
}
