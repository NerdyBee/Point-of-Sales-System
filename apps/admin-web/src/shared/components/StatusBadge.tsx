interface StatusBadgeProps {
  label: string;
  tone?: "success" | "warning" | "danger" | "info";
}

export function StatusBadge({ label, tone = "info" }: StatusBadgeProps) {
  return <span className={`status-badge status-${tone}`}>{label}</span>;
}
