interface StatCardProps {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  small?: boolean;
}

export function StatCard({ label, value, sub, small }: StatCardProps) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={small ? "value small" : "value"}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
