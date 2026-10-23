import React from "react";

export interface SearchFieldProps {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
}

export function SearchField({ value = "", onChange, placeholder = "Search" }: SearchFieldProps) {
  return (
    <label
      style={{
        height: "var(--size-input)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-input)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        cursor: "text",
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.4"
      >
        <circle cx="7" cy="7" r="5" />
        <path d="M11 11l3.5 3.5" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: 0,
          outline: "none",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: "var(--fs-13-5)",
        }}
      />
    </label>
  );
}
