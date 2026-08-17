import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function contextRouter(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "find_tools",
    label: "Find tools",
    description: "Find registered parent tools by capability.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 160 }),
      select: Type.Optional(Type.Array(Type.String({ maxLength: 80 }), { maxItems: 8 })),
    }),
    async execute() {
      return { content: [{ type: "text", text: "Tool discovery is unavailable." }], details: {} };
    },
  });

  pi.registerTool({
    name: "find_skills",
    label: "Find skills",
    description: "Find loaded skills by capability.",
    parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 160 }) }),
    async execute() {
      return { content: [{ type: "text", text: "Skill discovery is unavailable." }], details: {} };
    },
  });
}
