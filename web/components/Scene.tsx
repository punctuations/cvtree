import Image from "next/image";

import field from "@/app/field.png";

export function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <Image
        src={field}
        alt=""
        fill
        priority
        quality={90}
        sizes="100vw"
        placeholder="blur"
      />
    </div>
  );
}
