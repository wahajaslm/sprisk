export interface SearchFieldProps {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

/** The design's search box: a hairline box with a magnifier and the field. */
export function SearchField({ value = "", onChange, placeholder = "Search", ariaLabel }: SearchFieldProps) {
  return (
    <label className="dx-field" style={{ height: "32px", borderRadius: "var(--r-sm,6px)", border: "1px solid rgba(var(--ink-rgb,255,255,255),0.1)", display: "flex", alignItems: "center", gap: "8px", padding: "0 10px", color: "var(--t-faint,#8c8c8c)", fontSize: "13px" }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" style={{ flexShrink: "0" }}>
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" />
      </svg>
      <input
        type="search"
        role="searchbox"
        className="dx-input"
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
