"use client";

import { useState, type FormEvent } from "react";

import { useCachedLookup, useDirectLookup, type Lookup } from "@/lib/useLookup";

import { cacheEnabled } from "./ConvexClientProvider";
import { Report } from "./Report";

const EXAMPLES = [
  "lodash@4.17.15",
  "npm:express@4.17.1",
  "cargo:time@0.1.44",
  "pip:pyyaml@5.3.1",
];

export function Search() {
  return cacheEnabled ? <CachedSearch /> : <DirectSearch />;
}

function CachedSearch() {
  return <SearchView lookup={useCachedLookup()} />;
}

function DirectSearch() {
  return <SearchView lookup={useDirectLookup()} />;
}

function SearchView({ lookup }: { lookup: Lookup }) {
  const [input, setInput] = useState("");
  const { state, search } = lookup;

  function submit(event: FormEvent) {
    event.preventDefault();
    search(input);
  }

  function runExample(example: string) {
    setInput(example);
    search(example);
  }

  return (
    <>
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

      <p className="examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" onClick={() => runExample(example)}>
            {example}
          </button>
        ))}
      </p>

      {state.status === "loading" ? <p className="status">Querying OSV…</p> : null}

      {state.status === "error" ? (
        <p className="status error" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.status === "ready" ? <Report report={state.report} cached={state.cached} /> : null}
    </>
  );
}
