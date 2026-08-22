import type { Variants } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const stagger: Variants = {
  hidden: {},
  shown: {
    transition: { staggerChildren: 0.07, delayChildren: 0.04 },
  },
};

export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE },
  },
};

export const tileHover = {
  whileHover: { y: -3 },
  transition: { type: "spring" as const, stiffness: 320, damping: 28 },
};

export const tile: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.985 },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.45, ease: EASE },
  },
};
