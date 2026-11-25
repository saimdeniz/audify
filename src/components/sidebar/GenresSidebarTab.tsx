import React from "react";
import { TaxonomyDomainSidebarTab } from "./TaxonomyDomainSidebarTab";

interface GenresSidebarTabProps {
  dragHoverTarget: string | null;
  setDragHoverTarget: (target: string | null) => void;
  dropFlashTarget?: string | null;
}

export const GenresSidebarTab: React.FC<GenresSidebarTabProps> = (props) => (
  <TaxonomyDomainSidebarTab domain="genres" {...props} />
);
