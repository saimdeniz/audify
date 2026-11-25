import type { Collection } from "../types";

function compareCollectionNames(a: Collection, b: Collection): number {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export interface CollectionHierarchy {
  rootCollections: Collection[];
  childrenByParentId: Map<number, Collection[]>;
}

/**
 * Groups `collections` into top-level roots and sorted `childrenByParentId` lists.
 * Pass `excludeSmart: true` for manual assignment menus; pass `sortRoots: true`
 * when alphabetical root ordering is desired over DB order.
 */
export function buildCollectionHierarchy(
  collections: readonly Collection[],
  opts?: { excludeSmart?: boolean; sortRoots?: boolean }
): CollectionHierarchy {
  const excludeSmart = opts?.excludeSmart ?? false;
  const sortRoots = opts?.sortRoots ?? false;
  const roots: Collection[] = [];
  const childrenMap = new Map<number, Collection[]>();

  for (const c of collections) {
    if (excludeSmart && c.smart_query?.trim()) continue;
    if (c.parent_id) {
      const list = childrenMap.get(c.parent_id) ?? [];
      list.push(c);
      childrenMap.set(c.parent_id, list);
    } else {
      roots.push(c);
    }
  }

  for (const list of childrenMap.values()) {
    list.sort(compareCollectionNames);
  }
  if (sortRoots) {
    roots.sort(compareCollectionNames);
  }

  return { rootCollections: roots, childrenByParentId: childrenMap };
}
