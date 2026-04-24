interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
}

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div>
      <div
        style={{
          marginTop: 12,
          height: 6,
          borderRadius: 999,
          background: "var(--surface-alt)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--accent)",
            transition: "width .3s",
          }}
        />
      </div>
      {label && (
        <div
          className="muted"
          style={{
            color: "var(--text-faint)",
            fontSize: "12px",
            marginTop: 8,
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
