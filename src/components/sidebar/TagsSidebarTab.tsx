import React from "react";
import { TaxonomyDomainSidebarTab } from "./TaxonomyDomainSidebarTab";

interface TagsSidebarTabProps {
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
  dropFlashTarget?: string | null;
}

export const TagsSidebarTab: React.FC<TagsSidebarTabProps> = (props) => (
  <TaxonomyDomainSidebarTab domain="tags" {...props} />
);
