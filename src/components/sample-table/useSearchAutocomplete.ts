import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import type { Genre, Tag } from "../../types";
import type {
  SearchAutocompleteContext,
  SearchAutocompleteItem,
} from "../../utils/search/searchAutocomplete";

type SearchAutocompleteModule =
  typeof import("../../utils/search/searchAutocomplete");

let cachedAutoModule: SearchAutocompleteModule | null = null;
let inflightAutoModule: Promise<SearchAutocompleteModule> | null = null;

function preloadSearchAutocompleteModule(): Promise<SearchAutocompleteModule> {
  if (cachedAutoModule) return Promise.resolve(cachedAutoModule);
  if (!inflightAutoModule) {
    inflightAutoModule = import("../../utils/search/searchAutocomplete").then(
      (mod) => {
        cachedAutoModule = mod;
        return mod;
      }
    );
  }
  return inflightAutoModule;
}

export function useSearchAutocomplete({
  enabled,
  searchQuery,
  tags,
  genres,
  searchInputRef,
  setSearchQuery,
}: {
  enabled: boolean;
  searchQuery: string;
  tags: readonly Tag[];
  genres: readonly Genre[];
  searchInputRef: React.RefObject<HTMLInputElement>;
  setSearchQuery: (q: string) => void;
}) {
  const folderStats = useSampleStore((s) => s.folderStats);
  const artistStats = useSampleStore((s) => s.artistStats);
  const tagFacets = useSampleStore((s) => s.tagFacets);
  const [isFocused, setIsFocused] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const [autoMod, setAutoMod] = useState<SearchAutocompleteModule | null>(
    () => cachedAutoModule
  );

  const mayNeedAutocomplete =
    enabled &&
    isFocused &&
    (searchQuery.includes(":") || searchQuery.includes("#"));

  useEffect(() => {
    if (!enabled || !isFocused || autoMod) return;
    let alive = true;
    void preloadSearchAutocompleteModule().then((mod) => {
      if (alive) setAutoMod(() => mod);
    });
    return () => {
      alive = false;
    };
  }, [enabled, isFocused, autoMod]);

  useEffect(() => {
    if (!mayNeedAutocomplete || artistStats.length > 0) return;
    const lower = searchQuery.toLowerCase();
    if (
      lower.includes("artist:") ||
      lower.includes("author:") ||
      lower.includes("by:")
    ) {
      void useSampleStore.getState().fetchArtistStats();
    }
  }, [mayNeedAutocomplete, artistStats.length, searchQuery]);

  const context = useMemo((): SearchAutocompleteContext | null => {
    if (!mayNeedAutocomplete || !autoMod) return null;
    const ctx = autoMod.getSearchAutocompleteSuggestions(
      searchQuery,
      cursorPos,
      tags,
      genres,
      folderStats,
      tagFacets,
      artistStats
    );
    if (!ctx || ctx.rawToken === dismissedToken) return null;
    return ctx;
  }, [
    mayNeedAutocomplete,
    autoMod,
    searchQuery,
    cursorPos,
    tags,
    genres,
    folderStats,
    tagFacets,
    artistStats,
    dismissedToken,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [context?.rawToken, context?.items.length]);

  const accept = useCallback(
    (item: SearchAutocompleteItem) => {
      if (!context || !autoMod) return;
      const { nextQuery, nextCursor } = autoMod.applyAutocompleteSuggestion(
        searchQuery,
        context,
        item
      );
      setDismissedToken(null);
      setSearchQuery(nextQuery);
      setCursorPos(nextCursor);
      requestAnimationFrame(() => {
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.setSelectionRange(nextCursor, nextCursor);
        }
      });
    },
    [context, autoMod, searchQuery, setSearchQuery, searchInputRef]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!context || context.items.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % context.items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + context.items.length) % context.items.length
        );
        return true;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        const chosen = context.items[activeIndex] ?? context.items[0];
        if (chosen) accept(chosen);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedToken(context.rawToken);
        return true;
      }
      return false;
    },
    [context, activeIndex, accept]
  );

  return {
    context,
    activeIndex,
    setActiveIndex,
    accept,
    handleKeyDown,
    onFocus: (pos: number) => {
      setIsFocused(true);
      setCursorPos(pos);
      if (!cachedAutoModule) {
        void preloadSearchAutocompleteModule().then((mod) =>
          setAutoMod(() => mod)
        );
      }
    },
    onBlur: () => setIsFocused(false),
    onCursorChange: (pos: number) => setCursorPos(pos),
    onValueChange: (pos: number) => {
      setDismissedToken(null);
      setCursorPos(pos);
    },
  };
}
