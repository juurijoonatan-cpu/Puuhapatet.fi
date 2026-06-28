'use client';

import * as React from 'react';
import { motion, type Transition } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Shine — sweeps a soft light band across its child.
 *
 * Always renders THROUGH its single child (asChild semantics): the child is
 * cloned, made `relative overflow-hidden` so the sheen is clipped to its shape,
 * and an animated gradient layer is appended inside it. Works on a <Button>, a
 * plain <button>, a card, etc.
 *
 *   <Shine loop><Button>Tallenna</Button></Shine>
 *   <Shine enableOnHover><Card>…</Card></Shine>
 */
export type ShineProps = {
  children: React.ReactElement;
  /** Extra classes merged onto the child. */
  className?: string;
  /** Sheen tint — defaults to a soft white sweep. */
  color?: string;
  /** Seconds before the (first) sweep. */
  delay?: number;
  /** Seconds per sweep. */
  duration?: number;
  /** Repeat forever (ignored when triggered by hover/tap). */
  loop?: boolean;
  /** Seconds between loops. */
  loopDelay?: number;
  /** Sweep angle in degrees. */
  deg?: number;
  /** Auto-run on mount (default true). */
  enable?: boolean;
  /** Sweep once each time the child is hovered. */
  enableOnHover?: boolean;
  /** Sweep once each time the child is pressed. */
  enableOnTap?: boolean;
  /** Accepted for API compatibility — Shine always renders through its child. */
  asChild?: boolean;
};

export function Shine({
  children,
  className,
  color = 'rgba(255,255,255,0.55)',
  delay = 0,
  duration = 1.2,
  loop = false,
  loopDelay = 1,
  deg = 120,
  enable = true,
  enableOnHover = false,
  enableOnTap = false,
  asChild: _asChild = true,
}: ShineProps) {
  const child = React.Children.only(children) as React.ReactElement;
  const [burst, setBurst] = React.useState(0);

  const interactive = enableOnHover || enableOnTap;
  // Interaction-driven sweeps restart on each trigger by re-keying the layer.
  const layerKey = interactive ? burst : 'auto';
  const shouldAnimate = interactive ? burst > 0 : enable;

  const transition: Transition = {
    delay,
    duration,
    ease: 'easeInOut',
    ...(loop && !interactive ? { repeat: Infinity, repeatDelay: loopDelay } : {}),
  };

  const sheen = (
    <motion.span
      key={layerKey}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit]"
      style={{
        background: `linear-gradient(${deg}deg, transparent 35%, ${color} 50%, transparent 65%)`,
      }}
      initial={{ x: '-130%', opacity: 0 }}
      animate={shouldAnimate ? { x: '130%', opacity: [0, 1, 1, 0] } : { x: '-130%', opacity: 0 }}
      transition={transition}
    />
  );

  const merge =
    (orig: ((e: any) => void) | undefined, extra: () => void) =>
    (e: any) => {
      orig?.(e);
      extra();
    };

  return React.cloneElement(
    child,
    {
      className: cn('relative overflow-hidden', child.props.className, className),
      ...(enableOnHover
        ? { onMouseEnter: merge(child.props.onMouseEnter, () => setBurst((b) => b + 1)) }
        : {}),
      ...(enableOnTap
        ? { onPointerDown: merge(child.props.onPointerDown, () => setBurst((b) => b + 1)) }
        : {}),
    },
    child.props.children,
    sheen,
  );
}

export default Shine;
