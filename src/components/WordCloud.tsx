// 标签式词云：字号/颜色按频次缩放，悬停显示次数
export interface CloudWord {
  text: string;
  count: number;
}

const CLOUD_COLORS = [
  "#00b4b4", "#4f8ff7", "#9b7bff", "#4fd18b", "#f7b84f",
  "#6bcbe4", "#e46bb4", "#f7786b",
];

export default function WordCloud(props: {
  words: CloudWord[];
  maxWords?: number;
  emptyText?: string;
}) {
  const words = props.words.slice(0, props.maxWords ?? 60);
  if (words.length === 0) {
    return <div className="cloud-empty">{props.emptyText || "暂无词频数据"}</div>;
  }
  const max = words[0].count;
  const min = words[words.length - 1].count;
  const scale = (c: number) => {
    if (max === min) return 20;
    return 13 + ((c - min) / (max - min)) * 22; // 13px ~ 35px
  };
  return (
    <div className="word-cloud">
      {words.map((w, i) => (
        <span
          key={w.text}
          className="cloud-word"
          title={`${w.text}：出现 ${w.count} 次`}
          style={{
            fontSize: `${scale(w.count).toFixed(1)}px`,
            color: CLOUD_COLORS[i % CLOUD_COLORS.length],
            opacity: 0.65 + 0.35 * (w.count / max),
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
