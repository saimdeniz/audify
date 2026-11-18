import React, { useMemo } from "react";
import { CheckSquare, RefreshCw, Search } from "lucide-react";
import {
  collectSuggestedExtraDuplicateIds,
  makeDuplicateScopeKey,
  resolveDuplicateScopeLabel,
} from "../../store/slices/duplicateSlice";
import { useSampleStore } from "../../store/useSampleStore";
import { DuplicateScanMode } from "../../types";
import { filterVisibleLibraries, formatBytesCompact } from "../../utils/format";
import {
  DuplicateDropdownOption,
  DuplicateOptionDropdown,
} from "./DuplicateOptionDropdown";
import { ReadOnlyWriteModeButton } from "./ReadOnlyWriteModeButton";

const SIMILAR_MIN_OPTIONS: readonly DuplicateDropdownOption<number>[] = [
  { value: 99, label: ">= 99%", hint: "Strictest" },
  { value: 98, label: ">= 98%", hint: "Very strict" },
  { value: 97, label: ">= 97%", hint: "Recommended" },
  { value: 95, label: ">= 95%", hint: "Balanced" },
  { value: 90, label: ">= 90%", hint: "Variations" },
  { value: 85, label: ">= 85%", hint: "Loose" },
  { value: 80, label: "All", hint: "80%+ min" },
];

const EXTRAS_PCT_OPTIONS: readonly DuplicateDropdownOption<number>[] = [
  { value: 99, label: ">= 99%", hint: "Safest" },
  { value: 98, label: ">= 98%", hint: "High conf." },
  { value: 97, label: ">= 97%" },
  { value: 95, label: ">= 95%" },
  { value: 90, label: ">= 90%" },
  { value: 0, label: "All", hint: "No limit" },
];

interface DuplicateGeneralControlsProps {
  compact?: boolean;
}

/**
 * Contextual Duplicate Finder controls rendered on row 2 of Filters -> General
 * whenever `duplicatesFilterActive` is enabled (no native OS `<select>` elements).
 */
export const DuplicateGeneralControls: React.FC<DuplicateGeneralControlsProps> = ({
  compact = false,
}) => {
  const libraries = useSampleStore((s) => s.libraries);
  const samples = useSampleStore((s) => s.samples);
  const duplicateScanMode = useSampleStore((s) => s.duplicateScanMode);
  const duplicateLibraryId = useSampleStore((s) => s.duplicateLibraryId);
  const duplicateMinSimilarityPct = useSampleStore(
    (s) => s.duplicateMinSimilarityPct
  );
  const duplicateExtrasMinPct = useSampleStore((s) => s.duplicateExtrasMinPct);
  const duplicateScanResult = useSampleStore((s) => s.duplicateScanResult);
  const duplicateScanCache = useSampleStore((s) => s.duplicateScanCache);
  const isScanningDuplicates = useSampleStore((s) => s.isScanningDuplicates);
  const duplicateScanProgress = useSampleStore(
    (s) => s.duplicateScanProgress
  );
  const duplicateScanError = useSampleStore((s) => s.duplicateScanError);
  const enableAdvancedFileOps = useSampleStore((s) => s.enableAdvancedFileOps);

  const setDuplicateScope = useSampleStore((s) => s.setDuplicateScope);
  const setDuplicateExtrasMinPct = useSampleStore(
    (s) => s.setDuplicateExtrasMinPct
  );
  const scanDuplicates = useSampleStore((s) => s.scanDuplicates);
  const selectSuggestedDuplicateExtras = useSampleStore(
    (s) => s.selectSuggestedDuplicateExtras
  );

  const visibleLibraries = useMemo(
    () => filterVisibleLibraries(libraries),
    [libraries]
  );

  const scopeOptions = useMemo<DuplicateDropdownOption<string>[]>(
    () => [
      { value: "all", label: "All Libraries" },
      ...visibleLibraries.map((lib) => ({
        value: String(lib.id),
        label: lib.name,
      })),
    ],
    [visibleLibraries]
  );

  const selectedScopeLabel = useMemo(
    () => resolveDuplicateScopeLabel(libraries, duplicateLibraryId),
    [libraries, duplicateLibraryId]
  );

  const handleModeSwitch = (mode: DuplicateScanMode) => {
    if (mode === duplicateScanMode) return;
    setDuplicateScope(mode, duplicateLibraryId, duplicateMinSimilarityPct);
  };

  const handleLibraryScopeSelect = (raw: string) => {
    const libId = raw === "all" ? null : Number(raw);
    if (libId === duplicateLibraryId) return;
    setDuplicateScope(duplicateScanMode, libId, duplicateMinSimilarityPct);
  };

  const handleScanMinSelect = (pct: number) => {
    if (pct === duplicateMinSimilarityPct) return;
    setDuplicateScope(duplicateScanMode, duplicateLibraryId, pct);
  };

  const activeScopeKey = makeDuplicateScopeKey(
    duplicateScanMode,
    duplicateLibraryId,
    duplicateMinSimilarityPct
  );
  const hasScannedCurrentScope = Boolean(
    duplicateScanCache[activeScopeKey] || duplicateScanResult
  );

  const visibleIds = useMemo(
    () => (samples.length > 0 ? new Set(samples.map((s) => s.id)) : undefined),
    [samples]
  );

  const effectiveExtrasMinPct =
    duplicateScanMode === "similar" ? duplicateExtrasMinPct : 0;

  const eligibleExtraIds = useMemo(
    () =>
      collectSuggestedExtraDuplicateIds(
        duplicateScanResult,
        visibleIds,
        effectiveExtrasMinPct
      ),
    [duplicateScanResult, visibleIds, effectiveExtrasMinPct]
  );

  const extraCount = eligibleExtraIds.length;
  const extrasLabelSuffix =
    duplicateExtrasMinPct > 0 ? `>= ${duplicateExtrasMinPct}%` : "All";
  const extrasTriggerLabel =
    duplicateExtrasMinPct > 0
      ? compact
        ? `${duplicateExtrasMinPct}%+`
        : `>= ${duplicateExtrasMinPct}%`
      : "All";
  const scanMinTriggerLabel =
    duplicateMinSimilarityPct === 80
      ? "All"
      : compact
        ? `${duplicateMinSimilarityPct}%+`
        : `Min ${duplicateMinSimilarityPct}%`;
  const scopeTriggerLabel =
    compact && duplicateLibraryId === null ? "All Libs" : selectedScopeLabel;
  const compactIconOnlyScan =
    compact && (isScanningDuplicates || hasScannedCurrentScope);

  return (
    <div
      className={`border-t border-line-subtle flex items-center flex-wrap w-full ${
        compact ? "pt-1 gap-1" : "pt-1.5 gap-1.5"
      }`}
    >
      <div className="inline-flex items-center rounded-[3px] border border-line bg-surface-3 p-0.5 shrink-0">
        {(
          [
            {
              id: "exact",
              label: compact ? "Exact" : "Exact (SHA-256)",
              fullLabel: "Exact (SHA-256)",
            },
            {
              id: "similar",
              label: compact ? "Similar" : "Similar Audio",
              fullLabel: "Similar Audio",
            },
          ] as const
        ).map((m) => {
          const active = duplicateScanMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => handleModeSwitch(m.id)}
              disabled={isScanningDuplicates}
              title={m.fullLabel}
              className={`${
                compact
                  ? "h-[18px] px-1.5 text-[10px]"
                  : "h-[20px] px-2 text-[10.5px]"
              } rounded-[2px] font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                active
                  ? "bg-accent text-accent-on font-semibold"
                  : "text-fg-2 hover:text-fg"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {duplicateScanMode === "similar" && (
        <DuplicateOptionDropdown
          value={duplicateMinSimilarityPct}
          selectedLabel={scanMinTriggerLabel}
          options={SIMILAR_MIN_OPTIONS}
          onSelect={handleScanMinSelect}
          disabled={isScanningDuplicates}
          isActive={true}
          ariaLabel="Similar audio minimum similarity"
          listboxLabel="Minimum similarity threshold options"
          title={
            duplicateMinSimilarityPct === 80
              ? "Scan all Similar Audio matches (80%+ engine minimum similarity)"
              : "Minimum similarity percentage required to group Similar Audio pairs"
          }
          minMenuWidth={154}
          triggerClassName={
            compact
              ? "h-[22px] px-1.5 text-[10px]"
              : "h-[24px] px-2 text-[10.5px]"
          }
        />
      )}

      <DuplicateOptionDropdown
        value={duplicateLibraryId === null ? "all" : String(duplicateLibraryId)}
        selectedLabel={scopeTriggerLabel}
        options={scopeOptions}
        onSelect={handleLibraryScopeSelect}
        disabled={isScanningDuplicates}
        isActive={duplicateLibraryId !== null}
        ariaLabel="Duplicate library scope"
        listboxLabel="Library scope options"
        title="Select library scope for duplicate scan"
        minMenuWidth={150}
        triggerClassName={
          compact
            ? "h-[22px] min-w-[60px] max-w-[84px] px-1.5 text-[10px]"
            : "h-[24px] min-w-[118px] max-w-[170px] px-2 text-[10.5px]"
        }
      />

      <button
        type="button"
        onClick={() =>
          void scanDuplicates(
            duplicateScanMode,
            duplicateLibraryId,
            duplicateMinSimilarityPct
          )
        }
        disabled={isScanningDuplicates}
        aria-label={
          compactIconOnlyScan
            ? isScanningDuplicates
              ? "Scanning duplicates"
              : "Re-scan active duplicate scope"
            : undefined
        }
        className={`${
          compact
            ? compactIconOnlyScan
              ? "h-[22px] w-[24px] justify-center px-0 text-[10px]"
              : "h-[22px] px-1.5 text-[10px]"
            : "h-[24px] px-2 text-[10.5px]"
        } rounded-[3px] border font-mono inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 shrink-0 ${
          !hasScannedCurrentScope
            ? "bg-accent hover:bg-accent-hover border-accent text-accent-on font-semibold"
            : "border-line bg-surface-3 hover:border-accent text-fg-2 hover:text-accent-fg"
        }`}
        title={
          hasScannedCurrentScope
            ? "Re-scan active duplicate scope"
            : "Scan selected duplicate scope"
        }
      >
        {isScanningDuplicates ? (
          <RefreshCw className="w-3 h-3 shrink-0 animate-spin" />
        ) : hasScannedCurrentScope ? (
          <RefreshCw className="w-3 h-3 shrink-0" />
        ) : (
          <Search className="w-3 h-3 shrink-0" />
        )}
        {!compactIconOnlyScan && (
          <span>
            {isScanningDuplicates
              ? "Scanning..."
              : hasScannedCurrentScope
                ? "Re-scan"
                : "Scan"}
          </span>
        )}
      </button>

      <div className="inline-flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => selectSuggestedDuplicateExtras()}
          disabled={isScanningDuplicates || extraCount === 0}
          className={`${
            compact
              ? "h-[22px] px-1.5 text-[10px]"
              : "h-[24px] px-2 text-[10.5px]"
          } rounded-[3px] border border-accent/50 bg-accent-soft hover:bg-accent hover:text-accent-on text-accent-fg font-mono font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none shrink-0`}
          title={
            duplicateScanMode === "similar"
              ? `Multi-select suggested extra copies with ${extrasLabelSuffix} similarity (preserves KEEP and Read-Only Vault copies)`
              : "Multi-select all suggested duplicate extra copies (preserves KEEP and Read-Only Vault copies)"
          }
        >
          <CheckSquare className="w-3 h-3 shrink-0" />
          <span>
            {compact
              ? `Extras (${extraCount.toLocaleString()})`
              : `Select Extras (${extraCount.toLocaleString()})`}
          </span>
        </button>

        {duplicateScanMode === "similar" && (
          <DuplicateOptionDropdown
            value={duplicateExtrasMinPct}
            selectedLabel={extrasTriggerLabel}
            options={EXTRAS_PCT_OPTIONS}
            onSelect={setDuplicateExtrasMinPct}
            disabled={isScanningDuplicates}
            isActive={duplicateExtrasMinPct > 0}
            ariaLabel="Extras selection minimum similarity"
            listboxLabel="Extras selection similarity options"
            title="Only include groups at or above this similarity % when clicking Select Extras"
            minMenuWidth={136}
            triggerClassName={
              compact
                ? "h-[22px] px-1.5 text-[10px]"
                : "h-[24px] px-1.5 text-[10px]"
            }
          />
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5 font-mono text-[10px] shrink-0">
        {duplicateScanError ? (
          <span
            className="text-danger truncate max-w-[200px]"
            title={duplicateScanError}
          >
            {duplicateScanError}
          </span>
        ) : isScanningDuplicates ? (
          <div className="flex items-center gap-1.5">
            <span className="text-fg-2">
              {duplicateScanProgress
                ? compact
                  ? `${Math.min(
                      100,
                      Math.max(0, Math.round(duplicateScanProgress.percentage))
                    )}%`
                  : `${duplicateScanProgress.stage_label} (${Math.min(
                      100,
                      Math.max(0, Math.round(duplicateScanProgress.percentage))
                    )}%)`
                : "Scanning..."}
            </span>
            {duplicateScanProgress && (
              <div
                className={`${
                  compact ? "w-[52px]" : "w-[88px]"
                } h-[5px] bg-surface-0 border border-line rounded-2xs overflow-hidden`}
              >
                <div
                  className="h-full bg-accent transition-[width] duration-75"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, Math.round(duplicateScanProgress.percentage))
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>
        ) : !compact && duplicateScanResult ? (
          <span className="text-fg-3">
            {duplicateScanResult.groups_found.toLocaleString()}{" "}
            {duplicateScanResult.groups_found === 1 ? "group" : "groups"} ·{" "}
            {formatBytesCompact(duplicateScanResult.reclaimable_bytes)} reclaimable
          </span>
        ) : null}

        {!enableAdvancedFileOps && <ReadOnlyWriteModeButton compact={compact} />}
      </div>
    </div>
  );
};
