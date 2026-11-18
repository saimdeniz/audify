import React from "react";
import { Check, ChevronDown, Folder, FolderOpen, Plus, X } from "lucide-react";
import { LicenseGroup, LicenseQuoteMode } from "../../types";
import { formatLicenseGroupLine } from "../../utils/format";

const QUOTE_MODE_LABELS: Record<LicenseQuoteMode, string> = {
  auto: "Auto",
  multi_only: "Multi",
  always: "On",
  never: "Off",
};

const QUOTE_MODE_OPTIONS: { id: LicenseQuoteMode; label: string }[] = [
  { id: "auto", label: "Quotes: Auto" },
  { id: "multi_only", label: "Quotes: Multi" },
  { id: "always", label: "Quotes: On" },
  { id: "never", label: "Quotes: Off" },
];

const TOKEN_CHIPS = [
  { token: '"{title}"', label: '"{title}"' },
  { token: "{title}", label: "{title}" },
  { token: "{artist}", label: "{artist}" },
  { token: "{folder}", label: "{folder}" },
] as const;

const LICENSE_TEMPLATE_PRESETS: {
  label: string;
  quoteMode: LicenseQuoteMode;
  buildTemplate: (artistName: string) => string;
}[] = [
  {
    label: "CC-BY 4.0",
    quoteMode: "auto",
    buildTemplate: (name) =>
      `"{title}" by ${name} - released under CC-BY 4.0. www.scottbuckley.com.au`,
  },
  {
    label: "Incompetech",
    quoteMode: "auto",
    buildTemplate: (name) =>
      `"{title}" ${name} (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/`,
  },
  {
    label: "Multi-Only",
    quoteMode: "multi_only",
    buildTemplate: (name) =>
      `{title} by ${name} (https://creatorchords.com) Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0) https://creativecommons.org/licenses/by/4.0/`,
  },
];

interface LicenseLinkedFoldersSectionProps {
  activeLicenseGroup: LicenseGroup;
  countsByFolder: Record<string, number>;
  manualFolderInput: string;
  setManualFolderInput: (val: string) => void;
  appendUniqueFolder: (folderPath: string) => Promise<void>;
  pickFolderForLicenseGroup: () => Promise<string | null>;
  updateLicenseGroup: (
    id: string,
    patch: Partial<Omit<LicenseGroup, "id">>
  ) => Promise<void>;
}

export const LicenseLinkedFoldersSection: React.FC<
  LicenseLinkedFoldersSectionProps
> = ({
  activeLicenseGroup,
  countsByFolder,
  manualFolderInput,
  setManualFolderInput,
  appendUniqueFolder,
  pickFolderForLicenseGroup,
  updateLicenseGroup,
}) => (
  <div className="space-y-1.5 pt-1 border-t border-line">
    <label className="text-[10px] font-mono text-fg-3 font-semibold">
      LINKED FOLDERS ({activeLicenseGroup.folders.length})
    </label>

    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = manualFolderInput.trim();
        if (!trimmed) return;
        await appendUniqueFolder(trimmed);
        setManualFolderInput("");
      }}
      className="flex items-center space-x-1"
    >
      <input
        type="text"
        value={manualFolderInput}
        onChange={(e) => setManualFolderInput(e.target.value)}
        placeholder="Paste folder path..."
        className="flex-1 min-w-0 h-[24px] bg-surface-2 border border-line focus:border-accent px-2 font-mono text-[10px] text-fg outline-none rounded-xs placeholder-fg-3"
      />
      <button
        type="submit"
        className="w-[24px] h-[24px] bg-surface-2 hover:border-accent border border-line text-fg-2 hover:text-fg rounded-xs flex items-center justify-center shrink-0 cursor-pointer"
        title="Add folder path"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={async () => {
          const picked = await pickFolderForLicenseGroup();
          if (picked) {
            await appendUniqueFolder(picked);
          }
        }}
        className="w-[24px] h-[24px] rounded-xs bg-accent-soft border border-accent text-accent-fg hover:bg-accent hover:text-accent-on flex items-center justify-center shrink-0 transition-colors cursor-pointer"
        title="Browse folder"
      >
        <FolderOpen className="w-3.5 h-3.5" />
      </button>
    </form>

    <div className="space-y-1 max-h-[110px] overflow-y-auto pr-0.5">
      {activeLicenseGroup.folders.length === 0 ? (
        <div className="p-2 text-center text-[10px] text-fg-3 font-mono border border-dashed border-line rounded-xs">
          No folders linked.
        </div>
      ) : (
        activeLicenseGroup.folders.map((folderPath) => {
          const countInFolder = countsByFolder[folderPath] ?? 0;
          return (
            <div
              key={folderPath}
              className="h-[26px] px-2 rounded-xs bg-surface-2 border border-line flex items-center justify-between space-x-2 text-[10px] font-mono"
            >
              <div className="flex items-center space-x-1.5 truncate min-w-0">
                <Folder className="w-3 h-3 text-accent-fg shrink-0" />
                <span className="truncate text-fg" title={folderPath}>
                  {folderPath}
                </span>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0">
                <span className="text-[9.5px] text-ok">{countInFolder}</span>
                <button
                  type="button"
                  onClick={() =>
                    void updateLicenseGroup(activeLicenseGroup.id, {
                      folders: activeLicenseGroup.folders.filter(
                        (f) => f !== folderPath
                      ),
                    })
                  }
                  className="w-[16px] h-[16px] flex items-center justify-center text-fg-3 hover:text-danger rounded-xs transition-colors cursor-pointer"
                  title="Unlink folder"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
);

interface LicenseTemplateEditorSectionProps {
  activeLicenseGroup: LicenseGroup;
  templateDraft: string;
  onChangeTemplateDraft: (nextTemplate: string) => void;
  onApplyImmediateTemplate: (
    nextTemplate: string,
    quoteMode?: LicenseQuoteMode
  ) => void;
  onFlushPendingTemplate: () => void;
  isQuoteModeDropdownOpen: boolean;
  setIsQuoteModeDropdownOpen: (open: boolean) => void;
  updateLicenseGroup: (
    id: string,
    patch: Partial<Omit<LicenseGroup, "id">>
  ) => Promise<void>;
}

export const LicenseTemplateEditorSection: React.FC<
  LicenseTemplateEditorSectionProps
> = ({
  activeLicenseGroup,
  templateDraft,
  onChangeTemplateDraft,
  onApplyImmediateTemplate,
  onFlushPendingTemplate,
  isQuoteModeDropdownOpen,
  setIsQuoteModeDropdownOpen,
  updateLicenseGroup,
}) => (
  <div className="space-y-1.5 pt-1 border-t border-line">
    <div className="flex items-center justify-between">
      <label className="text-[10px] font-mono text-fg-3 font-semibold">
        TEMPLATE
      </label>

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setIsQuoteModeDropdownOpen(!isQuoteModeDropdownOpen)}
          className="h-[20px] px-1.5 bg-surface-2 hover:border-accent border border-line rounded-xs font-mono text-[9px] text-fg flex items-center space-x-1 transition-colors cursor-pointer"
          title="Quote formatting mode"
        >
          <span className="text-fg-3">Quotes:</span>
          <span className="font-semibold text-accent-fg">
            {QUOTE_MODE_LABELS[activeLicenseGroup.quoteMode || "auto"]}
          </span>
          <ChevronDown className="w-2.5 h-2.5 text-fg-3 shrink-0" />
        </button>

        {isQuoteModeDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsQuoteModeDropdownOpen(false)}
            />
            <div
              data-settings-dropdown-open="true"
              className="absolute right-0 top-full mt-1 w-36 bg-surface-2 border border-line rounded-md shadow-2xl py-1 z-50 font-mono text-[10px] backdrop-blur-md"
            >
              {QUOTE_MODE_OPTIONS.map((opt) => {
                const isCurrent =
                  (activeLicenseGroup.quoteMode || "auto") === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      void updateLicenseGroup(activeLicenseGroup.id, {
                        quoteMode: opt.id,
                      });
                      setIsQuoteModeDropdownOpen(false);
                    }}
                    className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between transition-colors cursor-pointer ${
                      isCurrent
                        ? "bg-accent-soft text-accent-fg font-bold"
                        : "text-fg-2 hover:bg-surface-3 hover:text-fg"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {isCurrent && (
                      <Check className="w-3 h-3 text-accent-fg shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-1">
      {TOKEN_CHIPS.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => {
            const nextTemplate = `${templateDraft}${
              templateDraft.endsWith(" ") ? "" : " "
            }${chip.token}`;
            onApplyImmediateTemplate(nextTemplate);
          }}
          className="h-[20px] px-1.5 rounded-xs bg-surface-2 hover:border-accent border border-line font-mono text-[9px] text-accent-fg transition-colors cursor-pointer"
          title={`Insert ${chip.label}`}
        >
          {chip.label}
        </button>
      ))}
    </div>

    <div className="flex items-center space-x-1 font-mono text-[9px]">
      {LICENSE_TEMPLATE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() =>
            onApplyImmediateTemplate(
              preset.buildTemplate(activeLicenseGroup.name),
              preset.quoteMode
            )
          }
          className="h-[20px] px-1.5 rounded-xs bg-surface-2 hover:border-accent border border-line text-fg-2 hover:text-fg transition-colors cursor-pointer"
        >
          {preset.label}
        </button>
      ))}
    </div>

    <textarea
      value={templateDraft}
      onChange={(e) => onChangeTemplateDraft(e.target.value)}
      onBlur={onFlushPendingTemplate}
      placeholder='"{title}" by {artist} - released under CC-BY 4.0.'
      className="w-full h-[58px] p-2 bg-surface-2 border border-line focus:border-accent font-mono text-[10.5px] text-fg outline-none rounded-xs resize-none leading-relaxed"
    />
  </div>
);

interface LicensePreviewSectionProps {
  activeLicenseGroup: LicenseGroup;
  templateDraft: string;
  activePreviewNames: string[];
  licensePreviewMode: "single" | "multi";
  setLicensePreviewMode: (mode: "single" | "multi") => void;
}

export const LicensePreviewSection: React.FC<LicensePreviewSectionProps> = ({
  activeLicenseGroup,
  templateDraft,
  activePreviewNames,
  licensePreviewMode,
  setLicensePreviewMode,
}) => {
  const singleSampleName = activePreviewNames[0] || "Aurea Carmina.mp3";
  const multiSampleNames =
    activePreviewNames.length >= 3
      ? activePreviewNames.slice(0, 3)
      : ["Aurea Carmina.mp3", "Club Seamus.wav", "DD Groove.mp3"];

  const previewLine = formatLicenseGroupLine(
    { ...activeLicenseGroup, template: templateDraft },
    licensePreviewMode === "single" ? [singleSampleName] : multiSampleNames,
    "Cinematic"
  );

  return (
    <div className="space-y-1 pt-1 border-t border-line">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-mono text-fg-3 font-semibold">
          PREVIEW
        </label>
        <div className="flex items-center p-0.5 bg-surface-2 border border-line rounded-xs">
          {(
            [
              { id: "single", label: "1x", title: "Single track preview" },
              { id: "multi", label: "3x", title: "3 merged tracks preview" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setLicensePreviewMode(opt.id)}
              className={`h-[16px] px-1.5 rounded-xs font-mono text-[9px] transition-colors cursor-pointer ${
                licensePreviewMode === opt.id
                  ? "bg-accent text-accent-on font-semibold"
                  : "text-fg-3 hover:text-fg"
              }`}
              title={opt.title}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="w-full max-h-[64px] p-2 rounded-xs bg-surface-0 border border-line font-mono text-[10px] text-fg break-words select-text leading-relaxed overflow-y-auto">
        {previewLine}
      </div>
    </div>
  );
};
