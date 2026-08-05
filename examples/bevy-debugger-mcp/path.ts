import { accessSync, constants } from "node:fs";

export function isCommandOnPath(command: string, path = process.env.PATH ?? ""): boolean {
  const suffixes = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return path.split(process.platform === "win32" ? ";" : ":").some((directory) =>
    suffixes.some((suffix) => {
      const candidate = `${directory || "."}/${command}${suffix}`;
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
}
