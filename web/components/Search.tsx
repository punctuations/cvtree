"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { useDeepLookup, type DeepLookup } from "@/lib/useDeepLookup";
import { useCachedLookup, useDirectLookup, type Lookup } from "@/lib/useLookup";
import { useErrorToast } from "@/lib/useToast";

import { isRepoReport } from "@/lib/model";

import { cacheEnabled } from "./ConvexClientProvider";
import { DeepReport } from "./DeepReport";
import { Report } from "./Report";
import { RepoReport } from "./RepoReport";
import { EASE, rise, stagger } from "./motion";

export function Search({ wordmark }: { wordmark: ReactNode }) {
  return cacheEnabled ? <CachedSearch wordmark={wordmark} /> : <DirectSearch wordmark={wordmark} />;
}

function CachedSearch({ wordmark }: { wordmark: ReactNode }) {
  return <SearchView wordmark={wordmark} lookup={useCachedLookup()} deep={useDeepLookup()} />;
}

function DirectSearch({ wordmark }: { wordmark: ReactNode }) {
  return <SearchView wordmark={wordmark} lookup={useDirectLookup()} deep={useDeepLookup()} />;
}

const SUGGESTIONS = [
  "lodash@4.17.15",
  "express@4.17.1",
  "cargo:time@0.1.44",
  "pip:pyyaml@5.3.1",
  "axios/axios",
];

const DEPTHS = [1, 2, 3];

function SearchView({
  wordmark,
  lookup,
  deep,
}: {
  wordmark: ReactNode;
  lookup: Lookup;
  deep: DeepLookup;
}) {
  const [input, setInput] = useState("");
  const [isDeep, setIsDeep] = useState(false);
  const [depth, setDepth] = useState(2);

  const state = isDeep ? deep.state : lookup.state;

  useErrorToast(lookup.state);
  useErrorToast(deep.state);

  function run(query: string, deepSearch: boolean, levels: number) {
    if (deepSearch) {
      deep.search(query, levels);
    } else {
      lookup.search(query);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    run(input, isDeep, depth);
  }

  return (
    <>
      <motion.section
        className={state.status === "ready" ? "stage stage-compact" : "stage"}
        variants={stagger}
        initial="hidden"
        animate="shown"
      >
        <motion.div variants={rise}>{wordmark}</motion.div>

        <motion.form className="search" onSubmit={submit} variants={rise}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="lodash@4.17.15"
            spellCheck={false}
            autoComplete="off"
            aria-label="Package name and version"
          />
          <motion.button
            type="submit"
            disabled={state.status === "loading"}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
          >
            {state.status === "loading" ? "Searching" : "Search"}
          </motion.button>
        </motion.form>

        <motion.div className="modes" variants={rise}>
          <motion.div className="mode-bar" layout transition={{ duration: 0.3, ease: EASE }}>
            <motion.button
              type="button"
              className="mode-switch"
              aria-pressed={isDeep}
              onClick={() => setIsDeep((on) => !on)}
              whileTap={{ scale: 0.97 }}
              layout
              transition={{ duration: 0.3, ease: EASE }}
            >
              Deep search
            </motion.button>

            <AnimatePresence initial={false}>
              {isDeep ? (
                <motion.div
                  className="depths"
                  role="group"
                  aria-label="Search depth"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <span className="depths-label">depth</span>
                  {DEPTHS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={level === depth ? "depth is-on" : "depth"}
                      aria-pressed={level === depth}
                      onClick={() => setDepth(level)}
                    >
                      {level === depth ? (
                        <motion.span
                          className="depth-marker"
                          layoutId="depth-marker"
                          transition={{ type: "spring", stiffness: 520, damping: 38 }}
                        />
                      ) : null}
                      <span className="depth-value">{level}</span>
                    </button>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </motion.div>

        <motion.ul className="suggestions" variants={stagger}>
          {SUGGESTIONS.map((suggestion) => (
            <motion.li key={suggestion} variants={rise}>
              <motion.button
                type="button"
                whileHover={{ scale: 1.06, y: -1 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
                onClick={() => {
                  setInput(suggestion);
                  run(suggestion, isDeep, depth);
                }}
              >
                {suggestion}
              </motion.button>
            </motion.li>
          ))}
        </motion.ul>

        <AnimatePresence>
          {state.status === "loading" ? (
            <motion.p
              className="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              {isDeep ? "Walking the dependency tree" : "Querying OSV"}
              <motion.span
                className="status-dots"
                aria-hidden="true"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                ...
              </motion.span>
            </motion.p>
          ) : null}
        </AnimatePresence>
      </motion.section>

      <AnimatePresence mode="wait">
        {isDeep && deep.state.status === "ready" ? (
          <ReportShell key="deep">
            <DeepReport report={deep.state.report} cached={false} />
          </ReportShell>
        ) : null}

        {!isDeep && lookup.state.status === "ready" ? (
          <ReportShell key="shallow">
            {isRepoReport(lookup.state.report) ? (
              <RepoReport report={lookup.state.report} />
            ) : (
              <Report report={lookup.state.report} cached={lookup.state.cached} />
            )}
          </ReportShell>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function ReportShell({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
