export default function ProgressBar(props: {
  current: number;
  total: number;
  etaText?: string;
}) {
  const pct = props.total > 0 ? Math.round((props.current / props.total) * 100) : 0;
  return (
    <div className="progress-wrap">
      <div className="progress-info">
        <span>
          {props.current} / {props.total}
        </span>
        <span className="progress-pct">{pct}%</span>
        {props.etaText && <span className="progress-eta">{props.etaText}</span>}
      </div>
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
