import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSampleStore } from "../../store/useSampleStore";
import {
  AutoTagCategoryConfig,
  AutoTagPreviewResult,
  AutoTagRule,
} from "../../types";
import { TagRuleCategoryList } from "./TagRuleCategoryList";
import { TagRuleInspector } from "./TagRuleInspector";
import { useMainFilterAction } from "./useMainFilterAction";

export const TagRulesSubtab: React.FC = () => {
  const activeProfileId = useSampleStore((s) => s.activeProfile?.id);
  const tags = useSampleStore((s) => s.tags);
  const autoTagRules = useSampleStore((s) => s.autoTagRules);
  const autoTagCategories = useSampleStore((s) => s.autoTagCategories);
  const sendFilterToMain = useMainFilterAction();

  const addAutoTagRule = useSampleStore((s) => s.addAutoTagRule);
  const previewAutoTagRule = useSampleStore((s) => s.previewAutoTagRule);
  const updateAutoTagRule = useSampleStore((s) => s.updateAutoTagRule);
  const deleteAutoTagRule = useSampleStore((s) => s.deleteAutoTagRule);
  const addAutoTagCategory = useSampleStore((s) => s.addAutoTagCategory);
  const renameAutoTagCategory = useSampleStore((s) => s.renameAutoTagCategory);
  const deleteAutoTagCategory = useSampleStore((s) => s.deleteAutoTagCategory);
  const setAutoTagCategoryPaths = useSampleStore(
    (s) => s.setAutoTagCategoryPaths
  );
  const pickFolderForLicenseGroup = useSampleStore(
    (s) => s.pickFolderForLicenseGroup
  );

  const [autoTagSearchQuery, setAutoTagSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, boolean>
  >({});
  const [confirmDeleteCategoryName, setConfirmDeleteCategoryName] = useState<
    string | null
  >(null);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState<
    string | null
  >(null);
  const [inspectorCategoryName, setInspectorCategoryName] = useState("");
  const [inspectorRuleKeywords, setInspectorRuleKeywords] = useState("");
  const [inspectorRuleTagName, setInspectorRuleTagName] = useState("");
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(
    null
  );
  const [isRuleOverridesOpen, setIsRuleOverridesOpen] = useState(false);
  const [isRuleCategoryDropdownOpen, setIsRuleCategoryDropdownOpen] =
    useState(false);
  const [inspectedRulePreview, setInspectedRulePreview] =
    useState<AutoTagPreviewResult | null>(null);

  useEffect(() => {
    setSelectedRuleId(null);
    setSelectedCategoryName(null);
    setConfirmDeleteRuleId(null);
    setConfirmDeleteCategoryName(null);
    setIsRuleCategoryDropdownOpen(false);
  }, [activeProfileId]);

  useEffect(() => {
    if (!isRuleCategoryDropdownOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsRuleCategoryDropdownOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [isRuleCategoryDropdownOpen]);

  const toggleCategoryCollapse = (cat: string) =>
    setCollapsedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));

  const allAvailableCategories = useMemo(() => {
    const canonicalByLower = new Map<string, string>();
    for (const c of autoTagCategories || []) {
      const clean = c.name.trim();
      if (clean && !canonicalByLower.has(clean.toLowerCase())) {
        canonicalByLower.set(clean.toLowerCase(), clean);
      }
    }
    for (const r of autoTagRules || []) {
      const clean = r.category?.trim();
      if (clean && !canonicalByLower.has(clean.toLowerCase())) {
        canonicalByLower.set(clean.toLowerCase(), clean);
      }
    }
    if (canonicalByLower.size === 0) {
      return ["SFX", "Ambience", "Music"];
    }
    return Array.from(canonicalByLower.values());
  }, [autoTagCategories, autoTagRules]);

  const filteredAutoTagRules = useMemo(() => {
    const q = autoTagSearchQuery.trim().toLowerCase();
    if (!q) return autoTagRules || [];
    return (autoTagRules || []).filter((r) => {
      const matchName = r.tag_name.toLowerCase().includes(q);
      const matchKw = (r.keywords || []).some((k) =>
        k.toLowerCase().includes(q)
      );
      const matchCat = (r.category || "").toLowerCase().includes(q);
      return matchName || matchKw || matchCat;
    });
  }, [autoTagRules, autoTagSearchQuery]);

  const rulesByCategory = useMemo(() => {
    const map = new Map<string, AutoTagRule[]>();
    const canonicalByLower = new Map<string, string>();
    for (const cat of allAvailableCategories) {
      map.set(cat, []);
      canonicalByLower.set(cat.toLowerCase(), cat);
    }
    const uncategorized: AutoTagRule[] = [];

    for (const rule of filteredAutoTagRules) {
      const rawCat = rule.category?.trim();
      if (!rawCat) {
        uncategorized.push(rule);
      } else {
        const canonical =
          canonicalByLower.get(rawCat.toLowerCase()) || rawCat;
        if (!map.has(canonical)) {
          map.set(canonical, []);
          canonicalByLower.set(canonical.toLowerCase(), canonical);
        }
        map.get(canonical)!.push(rule);
      }
    }
    if (uncategorized.length > 0) {
      map.set("Uncategorized", uncategorized);
    }
    return map;
  }, [allAvailableCategories, filteredAutoTagRules]);

  const visibleCategories = useMemo(() => {
    const list = Array.from(rulesByCategory.entries());
    const q = autoTagSearchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      ([cat, rules]) => rules.length > 0 || cat.toLowerCase().includes(q)
    );
  }, [rulesByCategory, autoTagSearchQuery]);

  const activeInspectedCategory = useMemo(() => {
    if (!selectedCategoryName) return null;
    if (selectedCategoryName === "Uncategorized") {
      return rulesByCategory.has("Uncategorized") ? "Uncategorized" : null;
    }
    const found = allAvailableCategories.find(
      (c) => c.toLowerCase() === selectedCategoryName.toLowerCase()
    );
    return found || null;
  }, [selectedCategoryName, allAvailableCategories, rulesByCategory]);

  const activeCategoryConfig: AutoTagCategoryConfig | null = useMemo(() => {
    if (!activeInspectedCategory) return null;
    return (
      autoTagCategories.find(
        (c) => c.name.toLowerCase() === activeInspectedCategory.toLowerCase()
      ) || {
        name: activeInspectedCategory,
        include_paths: [],
        exclude_paths: [],
      }
    );
  }, [activeInspectedCategory, autoTagCategories]);

  useEffect(() => {
    if (activeInspectedCategory) {
      setInspectorCategoryName(activeInspectedCategory);
    }
  }, [activeInspectedCategory]);

  const activeInspectedRule = useMemo(() => {
    if (selectedRuleId !== null) {
      const match = (autoTagRules || []).find((r) => r.id === selectedRuleId);
      if (match) return match;
    }
    return filteredAutoTagRules[0] || (autoTagRules || [])[0] || null;
  }, [autoTagRules, selectedRuleId, filteredAutoTagRules]);

  const activeRuleCategoryConfig: AutoTagCategoryConfig | null = useMemo(() => {
    const catName = activeInspectedRule?.category?.trim();
    if (!catName) return null;
    return (
      autoTagCategories.find(
        (c) => c.name.toLowerCase() === catName.toLowerCase()
      ) || null
    );
  }, [activeInspectedRule?.category, autoTagCategories]);

  const inspectedRuleId = activeInspectedRule?.id ?? null;
  const inspectedRuleKeywordsJoined = (
    activeInspectedRule?.keywords || []
  ).join(", ");
  const inspectedRuleTagName = activeInspectedRule?.tag_name || "";

  useEffect(() => {
    if (inspectedRuleId !== null) {
      setInspectorRuleKeywords(inspectedRuleKeywordsJoined);
      setInspectorRuleTagName(inspectedRuleTagName);
    }
  }, [inspectedRuleId, inspectedRuleKeywordsJoined, inspectedRuleTagName]);

  const runRulePreview = useCallback(
    async (rule: AutoTagRule, keywordsDraft: string) => {
      const kws = keywordsDraft
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const res = await previewAutoTagRule({
        ...rule,
        keywords: kws,
      });
      setInspectedRulePreview({
        match_count: res.match_count,
        sample_names: res.sample_names,
      });
    },
    [previewAutoTagRule]
  );

  useEffect(() => {
    if (activeInspectedCategory !== null || !activeInspectedRule) {
      setInspectedRulePreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void runRulePreview(activeInspectedRule, inspectorRuleKeywords);
    }, 280);
    return () => clearTimeout(timer);
  }, [
    activeInspectedCategory,
    activeInspectedRule,
    inspectorRuleKeywords,
    autoTagCategories,
    runRulePreview,
  ]);

  const appendUniqueFolderPath = (
    existing: string[] | undefined,
    pickedClean: string
  ): string[] | null => {
    const list = existing || [];
    if (list.some((p) => p.toLowerCase() === pickedClean.toLowerCase())) {
      return null;
    }
    return [...list, pickedClean];
  };

  const handleBrowseRulePath = async (ruleId: string, isInclude: boolean) => {
    const picked = await pickFolderForLicenseGroup();
    if (!picked) return;
    const clean = picked.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    const rule = autoTagRules.find((r) => r.id === ruleId);
    if (!rule) return;
    if (isInclude) {
      const next = appendUniqueFolderPath(rule.include_paths, clean);
      if (next) await updateAutoTagRule(ruleId, { include_paths: next });
    } else {
      const next = appendUniqueFolderPath(rule.exclude_paths, clean);
      if (next) await updateAutoTagRule(ruleId, { exclude_paths: next });
    }
  };

  const handleBrowseCategoryPath = async (
    categoryName: string,
    isInclude: boolean
  ) => {
    const picked = await pickFolderForLicenseGroup();
    if (!picked) return;
    const clean = picked.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    const current = autoTagCategories.find(
      (c) => c.name.toLowerCase() === categoryName.toLowerCase()
    );
    const inc = current?.include_paths || [];
    const exc = current?.exclude_paths || [];
    if (isInclude) {
      const nextInc = appendUniqueFolderPath(inc, clean);
      if (nextInc) await setAutoTagCategoryPaths(categoryName, nextInc, exc);
    } else {
      const nextExc = appendUniqueFolderPath(exc, clean);
      if (nextExc) await setAutoTagCategoryPaths(categoryName, inc, nextExc);
    }
  };

  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 flex-1 min-h-0">
        <TagRuleCategoryList
          autoTagSearchQuery={autoTagSearchQuery}
          setAutoTagSearchQuery={setAutoTagSearchQuery}
          allAvailableCategories={allAvailableCategories}
          autoTagRules={autoTagRules}
          autoTagCategories={autoTagCategories}
          filteredAutoTagRules={filteredAutoTagRules}
          visibleCategories={visibleCategories}
          collapsedCategories={collapsedCategories}
          toggleCategoryCollapse={toggleCategoryCollapse}
          activeInspectedCategory={activeInspectedCategory}
          activeInspectedRule={activeInspectedRule}
          confirmDeleteCategoryName={confirmDeleteCategoryName}
          setConfirmDeleteCategoryName={setConfirmDeleteCategoryName}
          onSelectCategory={(cat) => {
            setSelectedCategoryName(cat);
            setConfirmDeleteCategoryName(null);
          }}
          onSelectRule={(ruleId) => {
            setSelectedCategoryName(null);
            setSelectedRuleId(ruleId);
            setConfirmDeleteRuleId(null);
          }}
          addAutoTagCategory={addAutoTagCategory}
          deleteAutoTagCategory={deleteAutoTagCategory}
          addAutoTagRule={addAutoTagRule}
        />

        <TagRuleInspector
          tags={tags}
          allAvailableCategories={allAvailableCategories}
          rulesByCategory={rulesByCategory}
          activeInspectedCategory={activeInspectedCategory}
          activeCategoryConfig={activeCategoryConfig}
          activeInspectedRule={activeInspectedRule}
          activeRuleCategoryConfig={activeRuleCategoryConfig}
          inspectorCategoryName={inspectorCategoryName}
          setInspectorCategoryName={setInspectorCategoryName}
          inspectorRuleTagName={inspectorRuleTagName}
          setInspectorRuleTagName={setInspectorRuleTagName}
          inspectorRuleKeywords={inspectorRuleKeywords}
          setInspectorRuleKeywords={setInspectorRuleKeywords}
          confirmDeleteCategoryName={confirmDeleteCategoryName}
          setConfirmDeleteCategoryName={setConfirmDeleteCategoryName}
          confirmDeleteRuleId={confirmDeleteRuleId}
          setConfirmDeleteRuleId={setConfirmDeleteRuleId}
          isRuleCategoryDropdownOpen={isRuleCategoryDropdownOpen}
          setIsRuleCategoryDropdownOpen={setIsRuleCategoryDropdownOpen}
          isRuleOverridesOpen={isRuleOverridesOpen}
          setIsRuleOverridesOpen={setIsRuleOverridesOpen}
          inspectedRulePreview={inspectedRulePreview}
          onSelectCategory={setSelectedCategoryName}
          onSelectRule={(ruleId) => {
            setSelectedCategoryName(null);
            setSelectedRuleId(ruleId);
          }}
          sendFilterToMain={sendFilterToMain}
          renameAutoTagCategory={renameAutoTagCategory}
          deleteAutoTagCategory={deleteAutoTagCategory}
          setAutoTagCategoryPaths={setAutoTagCategoryPaths}
          updateAutoTagRule={updateAutoTagRule}
          deleteAutoTagRule={deleteAutoTagRule}
          runRulePreview={runRulePreview}
          handleBrowseRulePath={handleBrowseRulePath}
          handleBrowseCategoryPath={handleBrowseCategoryPath}
        />
      </div>
    </div>
  );
};
