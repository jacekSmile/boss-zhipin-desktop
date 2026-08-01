import type { ReactNode } from "react";

export default function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div
        className={`modal ${props.wide ? "modal-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-title">{props.title}</div>
          <button className="modal-close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
      </div>
    </div>
  );
}
