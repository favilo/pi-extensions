import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function clearReloadExtension(pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Clear the current context and reload extensions, skills, prompts, themes, and context files.",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			const parentSession = ctx.sessionManager.getSessionFile();

			const result = await ctx.newSession({
				parentSession,
				withSession: async (nextCtx) => {
					if (nextCtx.hasUI) {
						nextCtx.ui.notify("Context cleared. Reloading plugins…", "info");
					}

					await nextCtx.reload();
					return;
				},
			});

			if (result.cancelled && ctx.hasUI) {
				ctx.ui.notify("/clear cancelled by another extension.", "warning");
			}
		},
	});
}
