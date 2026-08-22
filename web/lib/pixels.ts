export interface PixelRun {
  x: number;
  y: number;
  length: number;
  token: string;
}

export function pixelRuns(map: string[]): PixelRun[] {
  const runs: PixelRun[] = [];

  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const token = row[x];
      if (token === ".") {
        x += 1;
        continue;
      }
      let length = 1;
      while (x + length < row.length && row[x + length] === token) {
        length += 1;
      }
      runs.push({ x, y, length, token });
      x += length;
    }
  });

  return runs;
}
