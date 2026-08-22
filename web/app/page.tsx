import { Hedge } from "@/components/Hedge";
import { Search } from "@/components/Search";
import { Wordmark } from "@/components/Wordmark";

export default function Home() {
  return (
    <>
      <main>
        <header className="hero">
          <Wordmark />
          <p className="tagline">Search a dependency for vulnerabilities</p>
        </header>
        <Search />
      </main>
      <footer className="garden">
        <Hedge />
        <p className="credit">
          Vulnerability data from <a href="https://osv.dev">OSV</a>
        </p>
      </footer>
    </>
  );
}
