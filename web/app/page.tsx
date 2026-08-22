import { Scene } from "@/components/Scene";
import { Search } from "@/components/Search";
import { Wordmark } from "@/components/Wordmark";

export default function Home() {
  return (
    <>
      <Scene />
      <main>
        <Search wordmark={<Wordmark />} />
      </main>
    </>
  );
}
