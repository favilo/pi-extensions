export type ToolActor = { kind: "main" } | { kind: "child"; childId: string };

export type ToolRequest = {
  actor: ToolActor;
  toolName: string;
  input: unknown;
  cwd: string;
  steering?: string;
};

export type PermissionDecision = "allow" | "deny" | "ask";
export type PermissionPromptResult = "allow" | "deny" | "cancel";
export type ToolExecutionResult = {
  status: "allowed" | "denied" | "cancelled" | "failed";
  actor: ToolActor;
  toolName: string;
  reason?: string;
  cwd?: string;
  summary?: string;
  steering?: string;
  value?: unknown;
};

export type ToolPermissionBoundary = {
  evaluate(request: ToolRequest): Promise<PermissionDecision>;
  prompt?(request: ToolRequest, signal?: AbortSignal): Promise<PermissionPromptResult>;
  execute(request: ToolRequest): Promise<unknown>;
  validate?(request: ToolRequest): string | undefined;
  audit?(entry: { actor: ToolActor; toolName: string; cwd: string; decision: string; reason?: string }): void;
};

function result(request: ToolRequest, status: ToolExecutionResult["status"], reason?: string, value?: unknown): ToolExecutionResult {
  return { status, actor: request.actor, toolName: request.toolName, ...(reason ? { reason } : {}), ...(value !== undefined ? { value } : {}) };
}

function audit(boundary: ToolPermissionBoundary, request: ToolRequest, decision: string, reason?: string): void {
  boundary.audit?.({ actor: request.actor, toolName: request.toolName, cwd: request.cwd, decision, ...(reason ? { reason } : {}) });
}

function unavailableUiResult(request: ToolRequest): ToolExecutionResult {
  return {
    status: "denied",
    actor: request.actor,
    toolName: request.toolName,
    reason: "unavailable_ui",
    cwd: request.cwd,
    summary: `${request.toolName} requires interactive approval.`,
    ...(request.steering ? { steering: request.steering } : {}),
  };
}

export async function executeToolRequest(
  request: ToolRequest,
  boundary: ToolPermissionBoundary,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  if (signal?.aborted) return result(request, "cancelled", "Tool action was cancelled before authorization.");

  const validationError = boundary.validate?.(request);
  if (validationError) {
    audit(boundary, request, "invalid_input", validationError);
    return result(request, "denied", validationError);
  }

  let decision: PermissionDecision;
  try {
    decision = await boundary.evaluate(request);
  } catch (error) {
    const reason = `Permission evaluation failed: ${error instanceof Error ? error.message : String(error)}`;
    audit(boundary, request, "policy_error", reason);
    return result(request, "denied", reason);
  }

  if (decision === "deny") {
    const reason = "Permission denied.";
    audit(boundary, request, decision, reason);
    return result(request, "denied", reason);
  }

  if (decision === "ask") {
    if (!boundary.prompt) {
      audit(boundary, request, "deny_no_ui", "Interactive approval is unavailable.");
      return unavailableUiResult(request);
    }
    try {
      const prompted = await boundary.prompt(request, signal);
      if (prompted === "cancel") {
        audit(boundary, request, "cancel_prompt", "Permission prompt was cancelled.");
        return result(request, "cancelled", "permission_prompt_cancelled");
      }
      if (prompted === "deny") {
        const reason = "Permission denied by the user.";
        audit(boundary, request, "deny_prompt", reason);
        return result(request, "denied", reason);
      }
      decision = "allow";
    } catch (error) {
      const reason = `Permission prompt failed: ${error instanceof Error ? error.message : String(error)}`;
      audit(boundary, request, "deny_prompt_error", reason);
      return result(request, "denied", reason);
    }
  }

  if (signal?.aborted) return result(request, "cancelled", "Tool action was cancelled before execution.");
  audit(boundary, request, decision);
  try {
    const value = await boundary.execute(request);
    audit(boundary, request, "executed");
    return result(request, "allowed", undefined, value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    audit(boundary, request, "failed", reason);
    return result(request, "failed", reason);
  }
}
