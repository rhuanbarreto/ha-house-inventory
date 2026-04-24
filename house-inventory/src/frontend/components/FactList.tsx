interface FactListProps {
  facts: Array<{ label: string; value: React.ReactNode }>;
}

export function FactList({ facts }: FactListProps) {
  return (
    <dl className="facts">
      {facts.map(({ label, value }) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
