import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-white text-black hover:bg-white/90",
        outline: "border border-white/20 text-white hover:bg-white/10",
        ghost:   "text-white hover:bg-white/10",
      },
      size: {
        default: "h-11 px-6 py-2",
        sm:      "h-9 px-4 text-xs",
        lg:      "h-13 px-8 text-base",
        icon:    "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

// Frosted-glass CTA button
function LiquidButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-sm font-semibold text-white transition-all duration-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
        className
      )}
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
      }}
      {...props}
    >
      <span
        className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "rgba(255,255,255,0.06)" }}
        aria-hidden
      />
      <span className="relative flex items-center gap-2">{children}</span>
    </button>
  );
}

// Solid white/black polished button
function MetalButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-7 py-3.5 text-sm font-semibold text-black transition-all duration-200 hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50",
        className
      )}
      style={{
        background: "linear-gradient(180deg, #ffffff 0%, #e4e4e4 100%)",
        boxShadow: "0 2px 12px rgba(255,255,255,0.2), inset 0 1px 0 rgba(255,255,255,0.5)",
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export { Button, buttonVariants, LiquidButton, MetalButton };
