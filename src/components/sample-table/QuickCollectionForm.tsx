import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useSampleStore } from "../../store/useSampleStore";

export interface QuickCollectionFormProps {
  placeholder: string;
  submitTitle: string;
  submitLabel?: string;
  className: string;
  inputClassName: string;
  submitClassName: string;
  onCreated: (collectionId: number) => Promise<void> | void;
}

/** Inline "create collection and add these samples" form shared by context menu and batch bar. */
export const QuickCollectionForm: React.FC<QuickCollectionFormProps> = ({
  placeholder,
  submitTitle,
  submitLabel,
  className,
  inputClassName,
  submitClassName,
  onCreated,
}) => {
  const createCollection = useSampleStore((s) => s.createCollection);
  const [name, setName] = useState("");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        const created = await createCollection(trimmed);
        if (created) {
          setName("");
          await onCreated(created.id);
        }
      }}
      className={className}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className={inputClassName}
      />
      <button type="submit" className={submitClassName} title={submitTitle}>
        <Plus className="w-3 h-3" />
        {submitLabel && <span>{submitLabel}</span>}
      </button>
    </form>
  );
};
