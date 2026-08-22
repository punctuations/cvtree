"use client";

import { motion } from "framer-motion";

import { boxStages, stageColor, TRUST_MAX, trustLabel } from "@/lib/trust";

import { EASE } from "./motion";

export function TrustMeter({
  score,
  size = "normal",
}: {
  score: number | null;
  size?: "normal" | "small";
}) {
  const stages = boxStages(score ?? 0);
  const reading = score === null ? "unrated" : `${score.toFixed(2)} out of ${TRUST_MAX}`;

  return (
    <span
      className={`trust trust-${size}`}
      role="img"
      aria-label={`Trust ${reading}, ${trustLabel(score)}`}
      title={`Trust ${reading}`}
    >
      <span className="trust-boxes">
        {stages.map((stage, index) => (
          <motion.span
            key={index}
            className="trust-box"
            data-stage={score === null ? 0 : stage}
            style={{ background: score === null ? undefined : stageColor(stage) }}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.25 + index * 0.05 }}
          />
        ))}
      </span>
      <span className="trust-reading">
        {score === null ? "unrated" : score.toFixed(2)}
        {score === null ? null : <i>/{TRUST_MAX}</i>}
      </span>
    </span>
  );
}
