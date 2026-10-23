import type { ChangeEvent } from "react";
import { SearchIcon } from "../../views/Icons.tsx";

export type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
};

/** Flow Studio SearchField: thin-outlined search input that sits under a sidebar title. */
export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  className = "",
  autoFocus = false,
}: SearchFieldProps) {
  return (
    <div className={`search-field ${className}`.trim()}>
      <SearchIcon />
      <input
        type="text"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          ×
        </button>
      )}
    </div>
  );
}
