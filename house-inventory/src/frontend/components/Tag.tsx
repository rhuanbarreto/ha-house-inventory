interface TagProps {
  children: React.ReactNode;
  variant?: "default" | "good" | "warn" | "danger" | "accent";
}

export function Tag({ children, variant = "default" }: TagProps) {
  const cls = variant === "default" ? "tag" : `tag ${variant}`;
  return <span className={cls}>{children}</span>;
}
