import React, { useEffect, useState } from "react";
import { Folder, FolderOpen, FolderPlus, Sparkles } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";
import { InlineConfirmDeleteButton } from "../common/InlineConfirmDeleteButton";
import { QuickCreatePopover } from "../QuickCreatePopover";
import { ModernToggleSwitch } from "./ModernToggleSwitch";

export const CollectionTemplatesPanel: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const collectionTemplates = useSampleStore((s) => s.collectionTemplates);
  const autoCreateCollectionSubfolders = useSampleStore(
    (s) => s.autoCreateCollectionSubfolders
  );
  const autoRouteCollectionDrops = useSampleStore(
    (s) => s.autoRouteCollectionDrops
  );
  const setAutoCreateCollectionSubfolders = useSampleStore(
    (s) => s.setAutoCreateCollectionSubfolders
  );
  const setAutoRouteCollectionDrops = useSampleStore(
    (s) => s.setAutoRouteCollectionDrops
  );

  const addCollectionTemplate = useSampleStore((s) => s.addCollectionTemplate);
  const updateCollectionTemplate = useSampleStore(
    (s) => s.updateCollectionTemplate
  );
  const deleteCollectionTemplate = useSampleStore(
    (s) => s.deleteCollectionTemplate
  );
  const pickFolderForCollectionTemplate = useSampleStore(
    (s) => s.pickFolderForCollectionTemplate
  );

  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<
    string | null
  >(null);

  useEffect(() => {
    setConfirmDeleteTemplateId(null);
  }, [activeProfileId]);

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="bg-surface-1 border border-line rounded-md flex flex-col max-h-[420px] min-h-0 overflow-hidden shrink-0">
        <div className="h-[36px] px-3 bg-surface-header border-b border-line flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
            <span className="text-[10.5px] font-mono font-semibold text-fg-2 uppercase tracking-wider">
              SUB-FOLDER TEMPLATES
            </span>
            <span className="text-[9.5px] font-mono text-fg-3 bg-surface-2 px-1.5 py-0.2 rounded-xs border border-line">
              {collectionTemplates.length}
            </span>
          </div>

          <QuickCreatePopover
            title="New Template"
            placeholder="Template folder name..."
            hasColor={false}
            buttonTitle="Add sub-folder template"
            buttonLabel="Add template"
            buttonClassName="h-[22px] px-2.5 bg-accent hover:bg-accent-hover text-accent-on rounded-xs inline-flex items-center space-x-1 text-[10.5px] font-semibold shadow-xs transition-colors cursor-pointer"
            onCreated={async (name) => {
              const trimmed = name.trim();
              const exists = collectionTemplates.some(
                (t) => t.name.trim().toLowerCase() === trimmed.toLowerCase()
              );
              await addCollectionTemplate({ name: trimmed });
              return !exists;
            }}
          />
        </div>

      <div className="h-[24px] px-3 bg-surface-sub border-b border-line grid grid-cols-[160px_1fr_auto] items-center gap-2 text-[9.5px] font-mono font-semibold text-fg-3 uppercase tracking-wider shrink-0">
        <span>NAME</span>
        <span>AUTO-ROUTE FOLDER</span>
        <span className="w-[52px]" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line-subtle">
        {collectionTemplates.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-fg-3 font-mono">
            No sub-folder templates defined. Click &ldquo;+ Add
            template&rdquo; to create custom sub-folder templates.
          </div>
        ) : (
          collectionTemplates.map((template) => {
            const isConfirmingDelete = confirmDeleteTemplateId === template.id;
            return (
              <div
                key={template.id}
                className="h-[34px] px-3 grid grid-cols-[160px_1fr_auto] items-center gap-2 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center space-x-1.5 min-w-0">
                  <Folder className="w-3.5 h-3.5 text-accent-fg shrink-0" />
                  <input
                    type="text"
                    defaultValue={template.name}
                    key={`${template.id}-${template.name}`}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (!val || val === template.name) {
                        e.target.value = template.name;
                        return;
                      }
                      const isDuplicate = collectionTemplates.some(
                        (t) =>
                          t.id !== template.id &&
                          t.name.trim().toLowerCase() === val.toLowerCase()
                      );
                      void updateCollectionTemplate(template.id, {
                        name: val,
                      });
                      if (isDuplicate) {
                        e.target.value = template.name;
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        e.currentTarget.value = template.name;
                        e.currentTarget.blur();
                      }
                    }}
                    className="w-full h-[22px] bg-surface-0 border border-line focus:border-accent text-[11px] font-semibold text-fg px-1.5 rounded-xs outline-none font-mono"
                    placeholder="Name"
                  />
                </div>

                <div className="min-w-0 h-[24px] flex items-center space-x-1.5 bg-surface-2 border border-line rounded-xs px-2">
                  <Folder className="w-3 h-3 text-accent-fg shrink-0" />
                  <span
                    className={`text-[10px] font-mono truncate select-text flex-1 ${
                      template.folder_path ? "text-fg" : "text-fg-3 italic"
                    }`}
                    title={
                      template.folder_path
                        ? `${template.folder_path} (Double-click to clear)`
                        : "No folder path rule"
                    }
                    onDoubleClick={() => {
                      if (template.folder_path) {
                        void updateCollectionTemplate(template.id, {
                          folder_path: "",
                        });
                      }
                    }}
                  >
                    {template.folder_path || "—"}
                  </span>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      const picked = await pickFolderForCollectionTemplate();
                      if (picked) {
                        await updateCollectionTemplate(template.id, {
                          folder_path: picked,
                        });
                      }
                    }}
                    className="w-[22px] h-[22px] flex items-center justify-center rounded-xs bg-surface-2 hover:bg-surface-3 hover:border-accent border border-line text-fg-2 hover:text-accent-fg shrink-0 cursor-pointer"
                    title="Browse auto-route folder"
                  >
                    <FolderOpen className="w-3 h-3" />
                  </button>

                  <InlineConfirmDeleteButton
                    isConfirming={isConfirmingDelete}
                    onRequest={() => setConfirmDeleteTemplateId(template.id)}
                    onConfirm={() => {
                      void deleteCollectionTemplate(template.id);
                      setConfirmDeleteTemplateId(null);
                    }}
                    onCancel={() => setConfirmDeleteTemplateId(null)}
                    deleteTitle="Delete template"
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      </div>

      {/* Template Automation Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 shrink-0">
        <div className="bg-surface-1 border border-line rounded-md px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-1.5 min-w-0">
              <FolderPlus className="w-3.5 h-3.5 text-accent-fg shrink-0" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg font-semibold truncate">
                AUTO-SUBFOLDERS
              </span>
            </div>
            <ModernToggleSwitch
              checked={autoCreateCollectionSubfolders}
              onChange={setAutoCreateCollectionSubfolders}
              title="Create template sub-folders automatically on new collections"
            />
          </div>
          <p className="text-[11px] text-fg-2">
            Creates these template folders inside every new collection.
          </p>
        </div>

        <div className="bg-surface-1 border border-line rounded-md px-3 py-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-1.5 min-w-0">
              <Sparkles className="w-3.5 h-3.5 text-accent-fg shrink-0" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-fg font-semibold truncate">
                SMART ROUTE
              </span>
            </div>
            <ModernToggleSwitch
              checked={autoRouteCollectionDrops}
              onChange={setAutoRouteCollectionDrops}
              title="Auto-sort dropped tracks by matching AUTO-ROUTE FOLDER"
            />
          </div>
          <p className="text-[11px] text-fg-2">
            Auto-sorts dropped tracks by matching{" "}
            <span className="font-mono text-fg">AUTO-ROUTE FOLDER</span>.
          </p>
        </div>
      </div>
    </div>
  );
};
