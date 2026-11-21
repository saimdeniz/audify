import React from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { Z_INDEX } from "../constants/zIndex";
import { useSampleStore } from "../store/useSampleStore";

type StoreSnapshot = ReturnType<typeof useSampleStore.getState>;
type StatusNotice = NonNullable<StoreSnapshot["statusNotice"]>;
type CreditToast = NonNullable<StoreSnapshot["creditToast"]>;

export const StatusNoticeToast: React.FC<{
  notice: StatusNotice;
  onDismiss: () => void;
}> = ({ notice, onDismiss }) => (
  <div
    key={notice.seq}
    role={notice.kind === "error" ? "alert" : "status"}
    aria-live={notice.kind === "error" ? "assertive" : "polite"}
    style={{ zIndex: Z_INDEX.statusToast }}
    data-mica-overlay="true"
    className={`fixed bottom-5 right-5 max-w-[min(420px,92vw)] rounded-md bg-surface-2 backdrop-blur-md border px-3 py-2 shadow-2xl flex items-center space-x-2.5 ${
      notice.kind === "error"
        ? "border-danger text-fg"
        : notice.kind === "success"
        ? "border-ok text-fg"
        : "border-accent text-fg"
    }`}
  >
    {notice.kind === "error" ? (
      <AlertCircle className="w-4 h-4 text-danger shrink-0" />
    ) : notice.kind === "success" ? (
      <CheckCircle2 className="w-4 h-4 text-ok shrink-0" />
    ) : (
      <Info className="w-4 h-4 text-accent-fg shrink-0" />
    )}
    <span className="text-[11.5px] font-mono leading-snug break-words flex-1">
      {notice.message}
    </span>
    <button
      type="button"
      onClick={onDismiss}
      className="w-[18px] h-[18px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-surface-3 shrink-0"
      aria-label="Dismiss notification"
    >
      <X className="w-3 h-3" />
    </button>
  </div>
);

export const CreditToastBanner: React.FC<{
  toast: CreditToast;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}> = ({ toast, onDismiss, onPause, onResume }) => (
  <div
    key={toast.seq}
    role="status"
    aria-live="polite"
    onMouseEnter={onPause}
    onMouseLeave={onResume}
    style={{ zIndex: Z_INDEX.creditToast }}
    className={`fixed bottom-8 right-4 w-[396px] max-w-[92vw] rounded-md bg-surface-2 border p-3 shadow-2xl space-y-2 ${
      toast.isWarning ? "border-accent" : "border-ok"
    }`}
  >
    <div className="flex items-start justify-between space-x-2">
      <div className="flex items-start space-x-2 min-w-0">
        {toast.isWarning ? (
          <AlertCircle className="w-4 h-4 text-accent-fg shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-fg leading-snug">
            {toast.title}
          </div>
          {toast.subtitle && (
            <div className="text-[11px] font-mono text-fg-2 truncate mt-0.5">
              {toast.subtitle}
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="w-[20px] h-[20px] rounded-xs flex items-center justify-center text-fg-3 hover:text-fg hover:bg-line shrink-0"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>

    {toast.previewText && (
      <div className="p-2 rounded-xs bg-surface-0 border border-line font-mono text-[10px] text-fg-2 max-h-[84px] overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
        {toast.previewText}
      </div>
    )}
  </div>
);
