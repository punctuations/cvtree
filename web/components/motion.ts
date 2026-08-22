import type { Variants } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const stagger: Variants = {
  hidden: {},
  shown: {
    transition: { staggerChildren: 0.05, delayChildren: 0.02 },
  },
};

export const rise: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.36, ease: EASE },
  },
};

export const tile: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.36, ease: EASE },
  },
};

export const tileHover = {
  whileHover: { y: -2 },
  transition: { duration: 0.18, ease: EASE },
};
