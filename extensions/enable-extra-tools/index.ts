import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXTRA_TOOLS = ["grep", "find", "ls"];

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const activeTools = pi.getActiveTools();
    pi.setActiveTools([...new Set([...activeTools, ...EXTRA_TOOLS])]);
  });

  pi.registerCommand("tools-debug", {
    description: "Show active and configured tools",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`Active: ${pi.getActiveTools().join(", ")}`, "info");
      ctx.ui.notify(
        `All: ${pi
          .getAllTools()
          .map((tool) => tool.name)
          .join(", ")}`,
        "info",
      );
    },
  });
}
