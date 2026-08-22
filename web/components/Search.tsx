"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { useDeepLookup, type DeepLookup } from "@/lib/useDeepLookup";
import { useCachedLookup, useDirectLookup, type Lookup } from "@/lib/useLookup";

import { isRepoReport } from "@/lib/model";

import { cacheEnabled } from "./ConvexClientProvider";
import { DeepReport } from "./DeepReport";
import { Report } from "./Report";
import { RepoReport } from "./RepoReport";

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
      <section className={state.status === "ready" ? "stage stage-compact" : "stage"}>
        {wordmark}

        <form className="search" onSubmit={submit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="lodash@4.17.15"
            spellCheck={false}
            autoComplete="off"
            aria-label="Package name and version"
          />
          <button type="submit" disabled={state.status === "loading"}>
            {state.status === "loading" ? "Searching" : "Search"}
          </button>
        </form>

        <div className="modes">
          <label className="toggle">
            <input
              type="checkbox"
              checked={isDeep}
              onChange={(event) => setIsDeep(event.target.checked)}
            />
            <span>Deep search</span>
          </label>

          {isDeep ? (
            <span className="depths">
              <span className="depths-label">depth</span>
              {DEPTHS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={level === depth ? "depth is-on" : "depth"}
                  onClick={() => setDepth(level)}
                >
                  {level}
                </button>
              ))}
            </span>
          ) : null}
        </div>

        <ul className="suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => {
                  setInput(suggestion);
                  run(suggestion, isDeep, depth);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>

        {state.status === "loading" ? (
          <p className="status">{isDeep ? "Walking the dependency tree" : "Querying OSV"}</p>
        ) : null}

        {state.status === "error" ? (
          <p className="status error" role="alert">
            {state.message}
          </p>
        ) : null}
      </section>

      {isDeep && deep.state.status === "ready" ? (
        <DeepReport report={deep.state.report} cached={false} />
      ) : null}

      {!isDeep && lookup.state.status === "ready" ? (
        isRepoReport(lookup.state.report) ? (
          <RepoReport report={lookup.state.report} />
        ) : (
          <Report report={lookup.state.report} cached={lookup.state.cached} />
        )
      ) : null}
    </>
  );
}
