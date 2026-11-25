import type { SampleItem, SampleTagBadge, Tag } from "../types";

const EMPTY_SAMPLE_TAGS: SampleTagBadge[] = [];
Object.freeze(EMPTY_SAMPLE_TAGS);

export interface InternSamplePoolResult {
  samples: SampleItem[];
  hadMissingTagIds: boolean;
}

/**
 * Deduplicates shared Tag objects, empty tag arrays, and repeated metadata strings
 * across a freshly deserialized `SampleItem[]` pool in a single linear pass.
 *
 * Also hydrates compact IPC `tag_ids` payloads into shared frozen `SampleTagBadge[]`
 * arrays using `tagDictionary`. Uses `s.tag_ids = undefined` (NEVER `delete s.tag_ids`)
 * so V8 preserves fast in-object hidden classes instead of deoptimizing 50k–150k rows
 * into slow `NameDictionary` hash tables (~47–67 MB savings on 50k pools).
 */
export function internSamplePoolWithStatus(
  samples: SampleItem[],
  tagDictionary?: readonly Tag[],
  opts?: { onlyUnresolvedTagIds?: boolean }
): InternSamplePoolResult {
  const len = samples.length;
  if (len === 0) return { samples, hadMissingTagIds: false };

  const onlyUnresolved = Boolean(opts?.onlyUnresolvedTagIds);
  const dictById = new Map<number, SampleTagBadge>();
  if (tagDictionary && tagDictionary.length > 0) {
    for (let i = 0; i < tagDictionary.length; i++) {
      const t = tagDictionary[i];
      dictById.set(
        t.id,
        Object.freeze({
          id: t.id,
          name: t.name,
          color: t.effective_color || t.color,
        })
      );
    }
  }

  const tagPool = new Map<string, SampleTagBadge>();
  const tagArrayPool = new Map<string, SampleTagBadge[]>();
  const strPool = new Map<string, string>();
  let hadMissingTagIds = false;

  const internStr = (val: string | undefined | null): string => {
    if (!val) return "";
    let existing = strPool.get(val);
    if (existing === undefined) {
      existing = val;
      strPool.set(val, existing);
    }
    return existing;
  };

  for (let i = 0; i < len; i++) {
    const s = samples[i];
    const compactIds = s.tag_ids;

    if (onlyUnresolved) {
      if (!Array.isArray(compactIds) || compactIds.length === 0) {
        continue;
      }
    } else {
      s.folder_path = internStr(s.folder_path);
      s.extension = internStr(s.extension);
      s.genre = internStr(s.genre);
      s.artist = internStr(s.artist);
      s.album = internStr(s.album);
      s.year = internStr(s.year);
      if (s.created_at) {
        s.created_at = internStr(s.created_at);
      }
      if (s.musical_key) {
        s.musical_key = internStr(s.musical_key);
      }
      if (s.camelot_key) {
        s.camelot_key = internStr(s.camelot_key);
      }
    }

    if (Array.isArray(compactIds) && compactIds.length > 0) {
      if (dictById.size > 0) {
        let rowMissing = false;
        let idKey = "";
        const resolved: SampleTagBadge[] = [];
        for (let tIdx = 0; tIdx < compactIds.length; tIdx++) {
          const tid = compactIds[tIdx];
          const badge = dictById.get(tid);
          if (!badge) {
            rowMissing = true;
            hadMissingTagIds = true;
            continue;
          }
          resolved.push(badge);
          idKey = resolved.length === 1 ? `id:${tid}` : `${idKey},${tid}`;
        }
        if (!rowMissing) {
          // Never `delete s.tag_ids` — assigning `undefined` keeps V8 fast in-object layout
          s.tag_ids = undefined;
        }
        if (resolved.length === 0) {
          s.tags = EMPTY_SAMPLE_TAGS;
        } else {
          let sharedArr = tagArrayPool.get(idKey);
          if (!sharedArr) {
            sharedArr = Object.freeze(resolved) as SampleTagBadge[];
            tagArrayPool.set(idKey, sharedArr);
          }
          s.tags = sharedArr;
        }
        continue;
      }
      // Without a tag dictionary (e.g. inside the Web Worker), NEVER overwrite already-hydrated `s.tags`.
      s.tag_ids = undefined;
    } else if (compactIds !== undefined) {
      s.tag_ids = undefined;
    }

    const tags = s.tags;
    if (!tags || tags.length === 0) {
      s.tags = EMPTY_SAMPLE_TAGS;
      continue;
    }

    const isFrozen = Object.isFrozen(tags);
    let needsCopy = false;
    let arrayKey = "";
    const mapped: SampleTagBadge[] | null = isFrozen ? new Array<SampleTagBadge>(tags.length) : null;

    for (let tIdx = 0; tIdx < tags.length; tIdx++) {
      const t = tags[tIdx];
      const key = `${t.id}\0${t.name}\0${t.color}`;
      let shared = tagPool.get(key);
      if (!shared) {
        shared = dictById.get(t.id) ?? (Object.isFrozen(t) ? t : Object.freeze(t));
        tagPool.set(key, shared);
      }
      if (isFrozen) {
        mapped![tIdx] = shared;
        if (shared !== t) {
          needsCopy = true;
        }
      } else {
        tags[tIdx] = shared;
      }
      arrayKey = tIdx === 0 ? key : `${arrayKey}\x01${key}`;
    }

    let sharedArr = tagArrayPool.get(arrayKey);
    if (!sharedArr) {
      const target = isFrozen ? (needsCopy ? mapped! : tags) : tags;
      sharedArr = Object.isFrozen(target)
        ? target
        : (Object.freeze(target) as SampleTagBadge[]);
      tagArrayPool.set(arrayKey, sharedArr);
    }
    s.tags = sharedArr;
  }

  return { samples, hadMissingTagIds };
}

export function internSamplePool(
  samples: SampleItem[],
  tagDictionary?: readonly Tag[]
): SampleItem[] {
  return internSamplePoolWithStatus(samples, tagDictionary).samples;
}
