import { Report } from "@/components/Report";
import { Scene } from "@/components/Scene";
import { packageReport } from "@/lib/report";

export default async function Preview() {
  const report = await packageReport("lodash", "4.17.15", "npm");

  return (
    <>
      <Scene />
      <main>
        <div style={{ height: "8vh" }} />
        <Report report={report} cached />
      </main>
    </>
  );
}
