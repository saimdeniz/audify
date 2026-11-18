import React, { useEffect, useRef, useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { LicenseGroup, LicenseQuoteMode } from "../../types";
import { InspectorShell } from "./InspectorShell";
import {
  LicenseLinkedFoldersSection,
  LicensePreviewSection,
  LicenseTemplateEditorSection,
} from "./LicenseGroupInspectorSections";
import { useMainFilterAction } from "./useMainFilterAction";

function normalizeFolderKey(folderPath: string): string {
  return folderPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

interface LicenseGroupInspectorProps {
  activeLicenseGroup: LicenseGroup | null;
  licenseCounts: {
    byGroup: Record<string, number>;
    byFolder: Record<string, number>;
  };
  activePreviewNames: string[];
  confirmDeleteLicenseId: string | null;
  setConfirmDeleteLicenseId: (id: string | null) => void;
}

export const LicenseGroupInspector: React.FC<LicenseGroupInspectorProps> = ({
  activeLicenseGroup,
  licenseCounts,
  activePreviewNames,
  confirmDeleteLicenseId,
  setConfirmDeleteLicenseId,
}) => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const updateLicenseGroup = useSampleStore((s) => s.updateLicenseGroup);
  const deleteLicenseGroup = useSampleStore((s) => s.deleteLicenseGroup);
  const pickFolderForLicenseGroup = useSampleStore(
    (s) => s.pickFolderForLicenseGroup
  );
  const sendFilterToMain = useMainFilterAction();

  const [inspectorArtistName, setInspectorArtistName] = useState("");
  const [isQuoteModeDropdownOpen, setIsQuoteModeDropdownOpen] = useState(false);
  const [manualFolderInput, setManualFolderInput] = useState("");
  const [licensePreviewMode, setLicensePreviewMode] = useState<
    "single" | "multi"
  >("single");
  const [templateDraft, setTemplateDraft] = useState("");
  const templateSaveTimerRef = useRef<number | null>(null);
  const pendingTemplateRef = useRef<{
    profileId: number | undefined;
    groupId: string;
    template: string;
  } | null>(null);

  const flushPendingTemplate = () => {
    if (templateSaveTimerRef.current !== null) {
      window.clearTimeout(templateSaveTimerRef.current);
      templateSaveTimerRef.current = null;
    }
    const pending = pendingTemplateRef.current;
    if (!pending) return;
    pendingTemplateRef.current = null;
    if (useSampleStore.getState().activeProfile?.id !== pending.profileId) {
      return;
    }
    void updateLicenseGroup(pending.groupId, { template: pending.template });
  };

  useEffect(() => {
    setIsQuoteModeDropdownOpen(false);
    if (templateSaveTimerRef.current !== null) {
      window.clearTimeout(templateSaveTimerRef.current);
      templateSaveTimerRef.current = null;
    }
    pendingTemplateRef.current = null;
  }, [activeProfileId]);

  useEffect(() => {
    if (activeLicenseGroup) {
      setInspectorArtistName(activeLicenseGroup.name);
      if (pendingTemplateRef.current?.groupId !== activeLicenseGroup.id) {
        setTemplateDraft(activeLicenseGroup.template);
      }
    } else {
      setTemplateDraft("");
    }
  }, [activeLicenseGroup]);

  useEffect(() => {
    return () => {
      flushPendingTemplate();
    };
    // Flush only when switching away from the currently inspected license group
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLicenseGroup?.id]);

  useEffect(() => {
    if (!isQuoteModeDropdownOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsQuoteModeDropdownOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [isQuoteModeDropdownOpen]);

  const appendUniqueFolder = async (folderPath: string) => {
    if (!activeLicenseGroup) return;
    const targetKey = normalizeFolderKey(folderPath);
    const exists = activeLicenseGroup.folders.some(
      (f) => normalizeFolderKey(f) === targetKey
    );
    if (!exists) {
      await updateLicenseGroup(activeLicenseGroup.id, {
        folders: [...activeLicenseGroup.folders, folderPath],
      });
    }
  };

  const handleApplyImmediateTemplate = (
    nextTemplate: string,
    quoteMode?: LicenseQuoteMode
  ) => {
    if (!activeLicenseGroup) return;
    if (templateSaveTimerRef.current !== null) {
      window.clearTimeout(templateSaveTimerRef.current);
      templateSaveTimerRef.current = null;
    }
    pendingTemplateRef.current = null;
    setTemplateDraft(nextTemplate);
    void updateLicenseGroup(activeLicenseGroup.id, {
      template: nextTemplate,
      ...(quoteMode ? { quoteMode } : {}),
    });
  };

  const handleChangeTemplateDraft = (nextTemplate: string) => {
    if (!activeLicenseGroup) return;
    setTemplateDraft(nextTemplate);
    pendingTemplateRef.current = {
      profileId: activeProfileId,
      groupId: activeLicenseGroup.id,
      template: nextTemplate,
    };
    if (templateSaveTimerRef.current !== null) {
      window.clearTimeout(templateSaveTimerRef.current);
    }
    templateSaveTimerRef.current = window.setTimeout(() => {
      flushPendingTemplate();
    }, 280);
  };

  return (
    <InspectorShell
      icon={<ShieldCheck className="w-3.5 h-3.5 text-accent-fg shrink-0" />}
      title="ARTIST INSPECTOR"
      hasItem={Boolean(activeLicenseGroup)}
      itemName={activeLicenseGroup?.name}
      subHeaderLabel="ATTRIBUTION & FOLDERS"
      onFilter={
        activeLicenseGroup
          ? () =>
              sendFilterToMain({
                kind: "license",
                id: activeLicenseGroup.id,
                label: activeLicenseGroup.name,
              })
          : undefined
      }
      filterTitle={
        activeLicenseGroup
          ? `Filter sample table by "${activeLicenseGroup.name}"`
          : undefined
      }
      canDelete={Boolean(activeLicenseGroup)}
      isConfirmingDelete={
        Boolean(activeLicenseGroup) &&
        confirmDeleteLicenseId === activeLicenseGroup?.id
      }
      onRequestDelete={() =>
        activeLicenseGroup && setConfirmDeleteLicenseId(activeLicenseGroup.id)
      }
      onConfirmDelete={async () => {
        if (!activeLicenseGroup) return;
        const id = activeLicenseGroup.id;
        setConfirmDeleteLicenseId(null);
        await deleteLicenseGroup(id);
      }}
      onCancelDelete={() => setConfirmDeleteLicenseId(null)}
      deleteTitle={
        activeLicenseGroup ? `Delete "${activeLicenseGroup.name}"` : undefined
      }
      emptyState={
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-2 text-fg-3">
          <FileCheck2 className="w-8 h-8 opacity-40 text-accent-fg" />
          <div className="text-[11px] font-mono">No artist group selected.</div>
          <div className="text-[9.5px] font-mono text-fg-3 max-w-[200px]">
            Select an artist group from the left list to view or edit details.
          </div>
        </div>
      }
    >
      {activeLicenseGroup && (
        <>
          <div className="h-[34px] px-3 bg-surface-soft border border-line rounded-xs flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                LINKED TRACKS
              </span>
              <span className="font-mono text-[13px] font-bold text-accent-fg tabular-nums">
                {(
                  licenseCounts.byGroup[activeLicenseGroup.id] ?? 0
                ).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono text-fg-3 uppercase tracking-wider font-semibold">
                FOLDERS
              </span>
              <span className="font-mono text-[12px] font-bold text-fg tabular-nums">
                {activeLicenseGroup.folders.length}
              </span>
            </div>
          </div>

          <div className="space-y-1 shrink-0">
            <label className="text-[10px] font-mono text-fg-3 font-semibold">
              NAME
            </label>
            <input
              type="text"
              value={inspectorArtistName}
              onChange={(e) => setInspectorArtistName(e.target.value)}
              onBlur={async () => {
                const clean = inspectorArtistName.trim();
                if (clean && clean !== activeLicenseGroup.name) {
                  await updateLicenseGroup(activeLicenseGroup.id, {
                    name: clean,
                  });
                } else {
                  setInspectorArtistName(activeLicenseGroup.name);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setInspectorArtistName(activeLicenseGroup.name);
                  e.currentTarget.blur();
                }
              }}
              className="w-full h-[26px] bg-surface-2 border border-line focus:border-accent px-2 text-[11px] font-medium text-fg outline-none rounded-xs font-mono"
            />
          </div>

          <LicenseLinkedFoldersSection
            activeLicenseGroup={activeLicenseGroup}
            countsByFolder={licenseCounts.byFolder}
            manualFolderInput={manualFolderInput}
            setManualFolderInput={setManualFolderInput}
            appendUniqueFolder={appendUniqueFolder}
            pickFolderForLicenseGroup={pickFolderForLicenseGroup}
            updateLicenseGroup={updateLicenseGroup}
          />

          <LicenseTemplateEditorSection
            activeLicenseGroup={activeLicenseGroup}
            templateDraft={templateDraft}
            onChangeTemplateDraft={handleChangeTemplateDraft}
            onApplyImmediateTemplate={handleApplyImmediateTemplate}
            onFlushPendingTemplate={flushPendingTemplate}
            isQuoteModeDropdownOpen={isQuoteModeDropdownOpen}
            setIsQuoteModeDropdownOpen={setIsQuoteModeDropdownOpen}
            updateLicenseGroup={updateLicenseGroup}
          />

          <LicensePreviewSection
            activeLicenseGroup={activeLicenseGroup}
            templateDraft={templateDraft}
            activePreviewNames={activePreviewNames}
            licensePreviewMode={licensePreviewMode}
            setLicensePreviewMode={setLicensePreviewMode}
          />
        </>
      )}
    </InspectorShell>
  );
};
