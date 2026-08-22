"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { useCachedLookup, useDirectLookup, type Lookup } from "@/lib/useLookup";

import { cacheEnabled } from "./ConvexClientProvider";
import { Report } from "./Report";

export function Search({ wordmark }: { wordmark: ReactNode }) {
  return cacheEnabled ? <CachedSearch wordmark={wordmark} /> : <DirectSearch wordmark={wordmark} />;
}

function CachedSearch({ wordmark }: { wordmark: ReactNode }) {
  return <SearchView wordmark={wordmark} lookup={useCachedLookup()} />;
}

function DirectSearch({ wordmark }: { wordmark: ReactNode }) {
  return <SearchView wordmark={wordmark} lookup={useDirectLookup()} />;
}

const SUGGESTIONS = ["lodash@4.17.15", "express@4.17.1", "cargo:time@0.1.44", "minimist@1.2.5"];

function SearchView({ wordmark, lookup }: { wordmark: ReactNode; lookup: Lookup }) {
  const [input, setInput] = useState("");
  const { state, search } = lookup;

  function submit(event: FormEvent) {
    event.preventDefault();
    search(input);
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

        <ul className="suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => {
                  setInput(suggestion);
                  search(suggestion);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>

        {state.status === "loading" ? <p className="status">Querying OSV</p> : null}

        {state.status === "error" ? (
          <p className="status error" role="alert">
            {state.message}
          </p>
        ) : null}
      </section>

      {state.status === "ready" ? (
        <Report report={state.report} cached={state.cached} />
      ) : null}
    </>
  );
}
