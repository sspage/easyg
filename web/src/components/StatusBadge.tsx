import React from "react";

type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

interface StatusBadgeProps {
  variant: BadgeVariant;
  label: string;
  size?: "sm" | "md";
}

const variantClassMap: Record<BadgeVariant, string> = {
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
  neutral: "badge-neutral",
};

export default function StatusBadge({
  variant,
  label,
  size = "md",
}: StatusBadgeProps): React.ReactElement {
  return (
    <span className={`badge ${variantClassMap[variant]} badge-${size}`}>
      {label}
    </span>
  );
}
