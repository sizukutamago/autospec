export type CommandType = "go" | "cancel" | "unknown";

export interface ParsedCommand {
  type: CommandType;
  args: string;
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const [command, ...rest] = trimmed.slice(1).split(/\s+/);
  const args = rest.join(" ");

  switch (command?.toLowerCase()) {
    case "go":
      return { type: "go", args };
    case "cancel":
      return { type: "cancel", args };
    default:
      return { type: "unknown", args };
  }
}
