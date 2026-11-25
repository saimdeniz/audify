import React, { useEffect, useMemo, useState } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  filterVisibleLibraries,
  isPathInsideFolder,
  isSampleInLicenseGroup,
} from "../../utils/format";
import { invokeCommand } from "../../utils/tauriCommands";
import { LicenseGroupInspector } from "./LicenseGroupInspector";
import { LicenseGroupList } from "./LicenseGroupList";

export const LicensesTab: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const libraries = useSampleStore((s) => s.libraries);
  const folderStats = useSampleStore((s) => s.folderStats);
  const artistStats = useSampleStore((s) => s.artistStats);
  const licenseGroups = useSampleStore((s) => s.licenseGroups);
  const licenseGroupMatchCounts = useSampleStore((s) => s.licenseGroupMatchCounts);
  const addLicenseGroup = useSampleStore((s) => s.addLicenseGroup);
  const fetchFolderStats = useSampleStore((s) => s.fetchFolderStats);
  const fetchArtistStats = useSampleStore((s) => s.fetchArtistStats);
  const refreshLicenseGroupCounts = useSampleStore(
    (s) => s.refreshLicenseGroupCounts
  );

  const [licenseManagerSearch, setLicenseManagerSearch] = useState("");
  const [activeLicenseId, setActiveLicenseId] = useState<string | null>(
    () => licenseGroups[0]?.id ?? null
  );
  const [confirmDeleteLicenseId, setConfirmDeleteLicenseId] = useState<
    string | null
  >(null);
  const [activePreviewNames, setActivePreviewNames] = useState<string[]>([]);

  useEffect(() => {
    setConfirmDeleteLicenseId(null);
  }, [activeProfileId]);

  useEffect(() => {
    if (folderStats.length === 0) {
      void fetchFolderStats();
    }
  }, [folderStats.length, fetchFolderStats]);

  useEffect(() => {
    if (artistStats.length === 0) {
      void fetchArtistStats();
    }
  }, [artistStats.length, fetchArtistStats]);

  const hasArtistLinkedGroups = useMemo(
    () => licenseGroups.some((g) => (g.artists?.length ?? 0) > 0),
    [licenseGroups]
  );

  useEffect(() => {
    if (hasArtistLinkedGroups) {
      void refreshLicenseGroupCounts();
    }
  }, [hasArtistLinkedGroups, licenseGroups, activeProfileId, refreshLicenseGroupCounts]);

  useEffect(() => {
    if (licenseGroups.length === 0) {
      setActiveLicenseId(null);
    } else if (
      !activeLicenseId ||
      !licenseGroups.some((g) => g.id === activeLicenseId)
    ) {
      setActiveLicenseId(licenseGroups[0].id);
    }
  }, [licenseGroups, activeLicenseId]);

  const filteredLicenseGroups = useMemo(() => {
    const q = licenseManagerSearch.trim().toLowerCase();
    if (!q) return licenseGroups;
    return licenseGroups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.folders.some((f) => f.toLowerCase().includes(q)) ||
        (g.rel_folders || []).some((rf) => rf.toLowerCase().includes(q)) ||
        (g.artists || []).some((a) => a.toLowerCase().includes(q))
    );
  }, [licenseGroups, licenseManagerSearch]);

  const activeLicenseGroup = useMemo(() => {
    if (activeLicenseId !== null) {
      const match = licenseGroups.find((g) => g.id === activeLicenseId);
      if (match) return match;
    }
    return filteredLicenseGroups[0] || licenseGroups[0] || null;
  }, [licenseGroups, activeLicenseId, filteredLicenseGroups]);

  const visibleLibraryIds = useMemo(
    () => new Set(filterVisibleLibraries(libraries).map((l) => l.id)),
    [libraries]
  );

  const licenseCounts = useMemo(() => {
    const byGroup: Record<string, number> = {};
    const byFolder: Record<string, number> = {};

    const visibleStats =
      folderStats.length > 0
        ? folderStats.filter((st) => visibleLibraryIds.has(st.library_id))
        : [];

    for (const stat of visibleStats) {
      for (const g of licenseGroups) {
        let inGroup = false;
        for (const f of g.folders) {
          if (isPathInsideFolder(stat.folder_path, f)) {
            inGroup = true;
            byFolder[f] = (byFolder[f] ?? 0) + stat.count;
          }
        }
        if (!inGroup && isSampleInLicenseGroup(stat.folder_path, g)) {
          inGroup = true;
        }
        if (inGroup) {
          byGroup[g.id] = (byGroup[g.id] ?? 0) + stat.count;
        }
      }
    }
    for (const g of licenseGroups) {
      if ((g.artists?.length ?? 0) > 0 && licenseGroupMatchCounts[g.id] !== undefined) {
        byGroup[g.id] = licenseGroupMatchCounts[g.id];
      }
    }
    return { byGroup, byFolder };
  }, [licenseGroups, folderStats, visibleLibraryIds, licenseGroupMatchCounts]);

  const activeFolders = activeLicenseGroup?.folders;
  const activeRelFolders = activeLicenseGroup?.rel_folders;
  const activeArtists = activeLicenseGroup?.artists;

  useEffect(() => {
    const hasFilters =
      (activeFolders && activeFolders.length > 0) ||
      (activeRelFolders && activeRelFolders.length > 0) ||
      (activeArtists && activeArtists.length > 0);
    if (!hasFilters) {
      setActivePreviewNames([]);
      return;
    }

    let cancelled = false;
    void invokeCommand("preview_license_group_samples", {
      folders: activeFolders ?? [],
      relFolders: activeRelFolders ?? [],
      artists: activeArtists ?? [],
      limit: 3,
    })
      .then((names) => {
        if (!cancelled) {
          setActivePreviewNames(names);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActivePreviewNames([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFolders, activeRelFolders, activeArtists]);

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
        <LicenseGroupList
          search={licenseManagerSearch}
          onSearchChange={setLicenseManagerSearch}
          filteredGroups={filteredLicenseGroups}
          totalGroupsCount={licenseGroups.length}
          countsByGroup={licenseCounts.byGroup}
          activeGroupId={activeLicenseGroup?.id ?? null}
          onSelectGroup={(id) => {
            setActiveLicenseId(id);
            setConfirmDeleteLicenseId(null);
          }}
          onCreateGroup={async (name) => {
            const created = await addLicenseGroup({
              name,
              folders: [],
              template: '"{title}" by {artist} - released under CC-BY 4.0.',
              quoteMode: "auto",
            });
            setActiveLicenseId(created.id);
            setConfirmDeleteLicenseId(null);
            return true;
          }}
        />

        <LicenseGroupInspector
          activeLicenseGroup={activeLicenseGroup}
          licenseCounts={licenseCounts}
          artistStats={artistStats}
          activePreviewNames={activePreviewNames}
          confirmDeleteLicenseId={confirmDeleteLicenseId}
          setConfirmDeleteLicenseId={setConfirmDeleteLicenseId}
        />
      </div>
    </div>
  );
};
