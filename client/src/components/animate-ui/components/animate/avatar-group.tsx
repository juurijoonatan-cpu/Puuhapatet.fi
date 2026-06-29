"use client";

/**
 * AvatarGroup — overlapping avatars that lift + reveal a name tooltip on hover/tap.
 * animate-ui style (framer-motion) over the base shadcn Avatar. Data-driven so it
 * stays robust against the base Avatar's `overflow-hidden` (tooltip is a sibling,
 * not a clipped child).
 */
import * as React from "react";
import { motion } from "framer-motion";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface AvatarGroupItem {
  src?: string;
  fallback: string;
  tooltip: string;
}

export function AvatarGroup({
  avatars,
  className,
  size = 48,
}: {
  avatars: AvatarGroupItem[];
  className?: string;
  size?: number;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  return (
    <div className={cn("flex items-center", className)}>
      {avatars.map((a, i) => {
        const hovered = active === i;
        return (
          <motion.div
            key={`${a.tooltip}-${i}`}
            className="relative"
            style={{ marginLeft: i === 0 ? 0 : -size * 0.28, zIndex: hovered ? 50 : avatars.length - i }}
            animate={{ y: hovered ? -6 : 0, scale: hovered ? 1.08 : 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            onHoverStart={() => setActive(i)}
            onHoverEnd={() => setActive((v) => (v === i ? null : v))}
            onTouchStart={() => setActive((v) => (v === i ? null : i))}
          >
            <Avatar
              className="border-[3px] border-background shadow-sm"
              style={{ width: size, height: size }}
            >
              {a.src && <AvatarImage src={a.src} alt={a.tooltip} className="object-cover" />}
              <AvatarFallback className="text-sm font-semibold text-muted-foreground">{a.fallback}</AvatarFallback>
            </Avatar>
            <motion.span
              initial={false}
              animate={{ opacity: hovered ? 1 : 0, y: hovered ? 0 : 4 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md"
            >
              {a.tooltip}
            </motion.span>
          </motion.div>
        );
      })}
    </div>
  );
}
