import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import Modal from "../components/Modal";
import {
  deleteResume,
  listResumes,
  readResumeBase64,
  saveResume,
} from "../api/tauri";
import {
  base64ToBlob,
  downloadBlob,
  fileToBase64,
  formatBytes,
  formatTime,
} from "../utils";
import type { ResumeInfo } from "../types";

const ACCEPT = [".pdf", ".md", ".txt", ".doc", ".docx"];

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export default function Resumes() {
  const { toast, settings, updateSettings } = useStore();
  const [resumes, setResumes] = useState<ResumeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{
    info: ResumeInfo;
    url?: string;
    text?: string;
    unsupported?: boolean;
    b64: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setResumes(await listResumes());
    } catch (e) {
      toast(`读取简历列表失败：${String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!ACCEPT.includes(ext)) {
        toast(`不支持的格式：${f.name}`, "warning");
        continue;
      }
      try {
        const b64 = await fileToBase64(f);
        await saveResume(f.name, b64);
        ok++;
      } catch (e) {
        toast(`保存 ${f.name} 失败：${String(e)}`, "error");
      }
    }
    if (ok > 0) toast(`已保存 ${ok} 份简历`, "success");
    setUploading(false);
    void refresh();
  };

  const openPreview = async (info: ResumeInfo) => {
    try {
      const b64 = await readResumeBase64(info.name);
      const ext = info.ext.toLowerCase();
      if (ext === "pdf") {
        const url = URL.createObjectURL(base64ToBlob(b64, MIME.pdf));
        setPreview({ info, b64, url });
      } else if (ext === "txt" || ext === "md") {
        const text = new TextDecoder("utf-8").decode(
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        );
        setPreview({ info, b64, text });
      } else {
        setPreview({ info, b64, unsupported: true });
      }
    } catch (e) {
      toast(`读取简历失败：${String(e)}`, "error");
    }
  };

  const exportFile = (info: ResumeInfo, b64: string) => {
    const blob = base64ToBlob(b64, MIME[info.ext.toLowerCase()] || "application/octet-stream");
    downloadBlob(blob, info.name);
  };

  const onDelete = async (info: ResumeInfo) => {
    if (!window.confirm(`确定删除「${info.name}」吗？`)) return;
    try {
      await deleteResume(info.name);
      toast("已删除", "info");
      void refresh();
    } catch (e) {
      toast(`删除失败：${String(e)}`, "error");
    }
  };

  return (
    <div className="view resumes-view">
      <div className="card">
        <div className="card-head">
          <div className="card-title">我的简历（{resumes.length}）</div>
          <label className={`btn btn-primary btn-sm upload-btn ${uploading ? "disabled" : ""}`}>
            {uploading ? "上传中…" : "上传简历"}
            <input
              type="file"
              multiple
              accept={ACCEPT.join(",")}
              style={{ display: "none" }}
              onChange={(e) => {
                void onUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="form-hint">支持 pdf / md / txt / doc / docx，文件仅保存在本机应用数据目录。</div>
        {loading ? (
          <div className="loading-block">读取中…</div>
        ) : resumes.length === 0 ? (
          <div className="empty-block">
            <div className="empty-icon">▤</div>
            <div>还没有简历，点击右上角「上传简历」</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小</th>
                <th>修改时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {resumes.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{formatBytes(r.size)}</td>
                  <td>{formatTime(r.modified_ms)}</td>
                  <td className="row-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => void openPreview(r)}>
                      预览
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => void onDelete(r)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">简历要点 / 自我介绍</div>
        <div className="form-hint">
          填写后可在打招呼模板中用 {"{自我介绍}"} 引用，保存在本机浏览器存储中。
        </div>
        <textarea
          className="input textarea"
          rows={6}
          placeholder="例如：3 年前端经验，熟悉 React / TypeScript，主导过 B 端中后台项目，重视性能与工程质量。"
          value={settings.selfIntro}
          onChange={(e) => updateSettings({ selfIntro: e.target.value })}
        />
      </div>

      {preview && (
        <Modal
          title={`预览 · ${preview.info.name}`}
          wide
          onClose={() => {
            if (preview.url) URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        >
          {preview.url && <iframe className="pdf-frame" src={preview.url} title="简历预览" />}
          {preview.text !== undefined && (
            <pre className="text-preview">{preview.text}</pre>
          )}
          {preview.unsupported && (
            <div className="empty-block">
              <div>暂不支持在线预览该格式（{preview.info.ext}）</div>
              <div className="empty-sub">可导出后用本地软件打开</div>
            </div>
          )}
          <div className="modal-actions">
            <button
              className="btn btn-primary"
              onClick={() => exportFile(preview.info, preview.b64)}
            >
              导出副本
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
