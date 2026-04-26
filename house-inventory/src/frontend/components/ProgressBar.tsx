interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
}

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div>
      <div className="progress-track">
        <div className="progress-fill" style={{ "--pct": `${pct}%` } as React.CSSProperties} />
      </div>
      {label && <div className="muted progress-label">{label}</div>}
    </div>
  );
}
