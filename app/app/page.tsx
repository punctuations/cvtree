import { Search } from "@/components/Search";

export default function Home() {
  return (
    <main>
      <header className="hero">
        <h1>cvtree</h1>
        <p>Search a dependency for vulnerabilities</p>
      </header>
      <Search />
      <footer>
        Vulnerability data from <a href="https://osv.dev">OSV</a>
      </footer>
    </main>
  );
}
