import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import {
  ensureChatPage,
  getChatMessages,
  listConversations,
  openConversation,
  sendChatMessage,
} from "../api/boss";
import type { ChatMessage, Conversation } from "../types";

export default function Chat() {
  const { toast, bossOpen } = useStore();
  const [pageReady, setPageReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [position, setPosition] = useState("");
  const [msgLoading, setMsgLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const msgBoxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<Conversation | null>(null);
  activeRef.current = active;

  const prepare = useCallback(async () => {
    setPreparing(true);
    setPrepareError(null);
    try {
      await ensureChatPage();
      setPageReady(true);
      const list = await listConversations();
      setConversations(list);
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : String(e));
      setPageReady(false);
    } finally {
      setPreparing(false);
    }
  }, []);

  const refreshList = useCallback(async (silent = false) => {
    if (!silent) setListLoading(true);
    try {
      const list = await listConversations();
      setConversations(list);
    } catch (e) {
      if (!silent) toast(`刷新会话失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      if (!silent) setListLoading(false);
    }
  }, [toast]);

  const loadMessages = useCallback(async () => {
    setMsgLoading(true);
    try {
      const r = await getChatMessages();
      setMessages(r.messages);
      setPosition(r.position);
    } catch (e) {
      toast(`读取消息失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setMsgLoading(false);
    }
  }, [toast]);

  const openConv = useCallback(
    async (c: Conversation) => {
      setActive(c);
      setMessages([]);
      setPosition("");
      try {
        await openConversation(c.index);
        await new Promise((r) => setTimeout(r, 800));
        await loadMessages();
      } catch (e) {
        toast(`打开会话失败：${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
    [loadMessages, toast]
  );

  // 自动刷新会话列表（15s）
  useEffect(() => {
    if (!pageReady || !autoRefresh) return;
    const t = setInterval(() => {
      void refreshList(true);
      if (activeRef.current) void loadMessages();
    }, 15000);
    return () => clearInterval(t);
  }, [pageReady, autoRefresh, refreshList, loadMessages]);

  useEffect(() => {
    msgBoxRef.current?.scrollTo({ top: msgBoxRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendChatMessage(text);
      setInput("");
      await loadMessages();
      toast("已发送", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSending(false);
    }
  };

  if (!pageReady) {
    return (
      <div className="view chat-view">
        <div className="empty-block chat-welcome">
          <div className="empty-icon">✉</div>
          <div className="chat-welcome-title">消息沟通</div>
          <div className="empty-sub">
            此功能在 BOSS 窗口的聊天页（zhipin.com/web/geek/chat）上操作，
            需要先登录。
          </div>
          {!bossOpen && (
            <div className="alert alert-warning inline-alert">
              BOSS 窗口未打开，请先在顶栏点击「打开登录窗口」并扫码登录。
            </div>
          )}
          {prepareError && <div className="alert alert-error inline-alert">{prepareError}</div>}
          <button className="btn btn-primary btn-lg" disabled={preparing} onClick={() => void prepare()}>
            {preparing ? "正在打开聊天页…" : "打开聊天页"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view chat-view">
      <div className="chat-layout">
        <div className="conv-pane">
          <div className="conv-toolbar">
            <span className="card-title">会话列表</span>
            <label className="auto-refresh">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              15秒自动刷新
            </label>
            <button className="btn btn-ghost btn-sm" disabled={listLoading} onClick={() => void refreshList()}>
              {listLoading ? "刷新中…" : "刷新"}
            </button>
          </div>
          <div className="conv-list">
            {conversations.length === 0 && (
              <div className="empty-sub conv-empty">暂无会话（或列表选择器未匹配，请点刷新重试）</div>
            )}
            {conversations.map((c) => (
              <button
                key={c.index}
                className={`conv-item ${active?.index === c.index ? "active" : ""}`}
                onClick={() => void openConv(c)}
              >
                <div className="conv-title-row">
                  <span className="conv-title">{c.title}</span>
                  {c.unread && <span className="unread-dot" />}
                </div>
                <div className="conv-preview">{c.preview || "（无预览）"}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="msg-pane">
          {!active ? (
            <div className="empty-block">
              <div className="empty-icon">☰</div>
              <div>选择左侧会话开始聊天</div>
            </div>
          ) : (
            <>
              <div className="msg-header">
                <div>
                  <div className="msg-title">{active.title}</div>
                  {position && <div className="msg-position">{position}</div>}
                </div>
                <button className="btn btn-ghost btn-sm" disabled={msgLoading} onClick={() => void loadMessages()}>
                  {msgLoading ? "加载中…" : "刷新消息"}
                </button>
              </div>
              <div className="msg-box" ref={msgBoxRef}>
                {msgLoading && messages.length === 0 && (
                  <div className="loading-block">正在读取消息…</div>
                )}
                {!msgLoading && messages.length === 0 && (
                  <div className="empty-sub conv-empty">暂无消息记录</div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`msg-row ${m.from === "me" ? "msg-me" : "msg-boss"}`}>
                    <div className="msg-bubble">{m.text}</div>
                  </div>
                ))}
              </div>
              <div className="msg-input-row">
                <textarea
                  className="input msg-input"
                  rows={2}
                  placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button className="btn btn-primary" disabled={sending || !input.trim()} onClick={() => void send()}>
                  {sending ? "发送中…" : "发送"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
