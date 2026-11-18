import React from "react";
import { TagLibrarySubtab } from "./TagLibrarySubtab";
import { TagRulesSubtab } from "./TagRulesSubtab";

interface TagsAndRulesTabProps {
  tagsSubTab: "rules" | "library";
}

export const TagsAndRulesTab: React.FC<TagsAndRulesTabProps> = ({
  tagsSubTab,
}) => {
  return tagsSubTab === "library" ? <TagLibrarySubtab /> : <TagRulesSubtab />;
};
