export type TaskStatus =
  | "waiting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "completed"
  | "disconnected";

export type FindingTone = "neutral" | "success" | "warning";

export type SupportingStep = {
  title: string;
  detail: string;
  path?: string;
};

export type CommandEvidence = {
  command: string;
  output: string;
};

export type Finding = {
  id: string;
  label: string;
  time: string;
  headline: string;
  explanation: string;
  tone: FindingTone;
  tentative?: boolean;
  sourceEventIds: string[];
  supportingSteps: SupportingStep[];
  commands: CommandEvidence[];
  throughSequence?: number;
  replacesFindingId?: string;
  origin?: "agent-commentary" | "background-summary";
};

export type DirectionState =
  | "none"
  | "sending"
  | "received"
  | "adoptionPending"
  | "adopted"
  | "agentDisagreed"
  | "agentAskedQuestion"
  | "deliveryFailed"
  | "deliveryUncertain"
  | "queuedForFollowUp";

export type Direction = {
  text: string;
  state: Exclude<DirectionState, "none">;
  detail: string;
};

export type CompletionSummary = {
  headline: string;
  detail: string;
  checks: string[];
  changedFiles: string[];
};

export type ApprovalAction = "accept" | "acceptForSession" | "decline" | "cancel";

export type ApprovalRequest = {
  requestId: string | number;
  method: string;
  title: string;
  detail: string;
  command?: string;
  cwd?: string;
  availableActions: ApprovalAction[];
  state: "pending" | "sending" | "resolved" | "failed" | "unsupported";
  permissionRequest?: PermissionRequestView;
  userInputRequest?: { questions: UserInputQuestionView[] };
  mcpElicitation?: McpElicitationView;
  error?: string;
};

export type PermissionRequestView = {
  networkRequested: boolean;
  readPaths: string[];
  writePaths: string[];
  hasUnsupportedEntries: boolean;
};

export type UserInputQuestionView = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};

export type McpElicitationFieldView = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean";
  required: boolean;
};

export type McpElicitationView = {
  mode: string;
  serverName: string;
  title?: string;
  message?: string;
  url?: string;
  challenge?: string;
  fields: McpElicitationFieldView[];
  formSupported: boolean;
};

export type TaskView = {
  taskId: string;
  title: string;
  repository: string;
  cwd?: string;
  branch: string;
  request: string;
  status: TaskStatus;
  statusLabel: string;
  currentActivity: string;
  nextStep?: string;
  currentFinding: Finding;
  history: Finding[];
  direction?: Direction;
  completion?: CompletionSummary;
  approval?: ApprovalRequest;
  fixtureLabel: string;
};
