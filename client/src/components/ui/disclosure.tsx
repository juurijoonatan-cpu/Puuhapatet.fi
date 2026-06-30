import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

/**
 * A smooth, height-animated disclosure ("dropdown") section. Collapsed it shows
 * only the header row — an icon, a title, and an optional right-hand value/badge
 * that stays visible even when closed (e.g. a status pill or the key number).
 * Tapping the header expands the content with a smooth grid-rows height
 * transition (no JS measuring, no layout jump). Used to fold the admin views'
 * info into tidy, fast-to-scan dropdowns.
 *
 * `variant="card"` (default) wraps it in a standalone card — for top-level
 * sections. `variant="inline"` is a lighter, chrome-free row meant to nest
 * inside an existing card (e.g. a worker card's sub-sections).
 *
 * Uncontrolled by default (`defaultOpen`); pass `open` + `onOpenChange` to drive
 * it from the parent.
 */
export function Disclosure({
  title,
  icon,
  right,
  variant = "card",
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** Shown on the right of the header, visible even when collapsed. */
  right?: ReactNode;
  variant?: "card" | "inline";
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolled;
  const toggle = () => {
    const next = !open;
    if (onOpenChange) onOpenChange(next);
    if (controlledOpen === undefined) setUncontrolled(next);
  };
  const inline = variant === "inline";

  const header = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      className={cn(
        "flex w-full items-center gap-2 text-left",
        inline ? "py-1" : "p-4 transition-colors hover:bg-accent/40 active:bg-accent/60",
      )}
    >
      {icon}
      <span className={cn("font-medium", inline ? "text-xs text-muted-foreground" : "text-sm text-foreground")}>
        {title}
      </span>
      <span className="ml-auto flex items-center gap-2.5 min-w-0">
        {right}
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
            inline ? "h-3.5 w-3.5" : "h-4 w-4",
            open && "rotate-180",
          )}
        />
      </span>
    </button>
  );

  // grid-rows 0fr→1fr is the smooth, content-agnostic height animation.
  const body = (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden min-h-0">
        <div className={cn(inline ? "pt-2" : "px-4 pb-4", contentClassName)}>{children}</div>
      </div>
    </div>
  );

  if (inline) {
    return <div className={className}>{header}{body}</div>;
  }
  return (
    <Card className={cn("bg-card border-0 premium-shadow mb-4 p-0 overflow-hidden", className)}>
      {header}
      {body}
    </Card>
  );
}
