export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly stage?: string,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

export class GateFailedError extends PipelineError {
  constructor(
    gate: string,
    public readonly reason: "p0_found" | "p1_exceeded" | "quorum_not_met",
  ) {
    super(`Gate "${gate}" failed: ${reason}`, gate);
    this.name = "GateFailedError";
  }
}

export class StateLoadError extends PipelineError {
  constructor(message: string) {
    super(message);
    this.name = "StateLoadError";
  }
}

export class StructuredOutputError extends PipelineError {
  constructor(
    stage: string,
    public readonly parseErrors: string[],
  ) {
    super(
      `Structured output validation failed in "${stage}": ${parseErrors.join(", ")}`,
      stage,
    );
    this.name = "StructuredOutputError";
  }
}
