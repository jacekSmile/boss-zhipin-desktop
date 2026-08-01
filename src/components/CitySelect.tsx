import { useEffect, useMemo, useRef, useState } from "react";
import cityCodesJson from "../city_codes.json";
import { fuzzyMatch } from "../utils";

const CITIES: Record<string, string> = cityCodesJson as Record<string, string>;
const CITY_NAMES = Object.keys(CITIES);
const HOT = ["全国", "北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "南京"];

export default function CitySelect(props: {
  value: string; // 城市名
  onChange: (name: string, code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filtered = useMemo(() => {
    if (!input.trim()) {
      const hot = HOT.filter((h) => CITIES[h]);
      const rest = CITY_NAMES.filter((n) => !hot.includes(n));
      return [...hot, ...rest].slice(0, 60);
    }
    return CITY_NAMES.filter((n) => fuzzyMatch(input.trim(), n)).slice(0, 60);
  }, [input]);

  return (
    <div className="city-select" ref={ref}>
      <button
        className="input city-trigger"
        onClick={() => {
          setOpen((o) => !o);
          setInput("");
        }}
      >
        <span>{props.value || "选择城市"}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="city-dropdown">
          <input
            autoFocus
            className="input city-search"
            placeholder="输入城市名模糊搜索…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <div className="city-list">
            {filtered.length === 0 && <div className="city-empty">无匹配城市</div>}
            {filtered.map((name) => (
              <button
                key={name}
                className={`city-item ${name === props.value ? "active" : ""}`}
                onClick={() => {
                  props.onChange(name, CITIES[name]);
                  setOpen(false);
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
