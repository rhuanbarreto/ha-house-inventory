interface StatCardProps {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  style?: React.CSSProperties;
}

export function StatCard({ label, value, sub, style }: StatCardProps) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={style}>
        {value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
