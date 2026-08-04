export type SpikeSession = {
  sessionId: string;
  prompt(text: string): Promise<void>;
  dispose(): void;
};

export type CreateSpikeSession = (options: { cwd: string }) => Promise<SpikeSession>;

export type AgentSessionSpikeOptions = {
  cwd: string;
  parentContext: string;
  task: string;
  createSession: CreateSpikeSession;
};

export type AgentSessionSpikeResult = {
  sessionId: string;
  cwd: string;
  completed: boolean;
  disposed: boolean;
};

export async function runAgentSessionSpike(_options: AgentSessionSpikeOptions): Promise<AgentSessionSpikeResult> {
  return {
    sessionId: "unimplemented",
    cwd: _options.cwd,
    completed: false,
    disposed: false,
  };
}
