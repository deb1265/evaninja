import { AgentOutput } from "./AgentOutput";
import { ChatMessage } from "../llm";

import { Result } from "@polywrap/result";

export interface RunnableAgent<TRunArgs> {
  run(
    args: TRunArgs
  ): AsyncGenerator<AgentOutput, RunResult, string | undefined>;
  runWithChat(
    messages: ChatMessage[]
  ): AsyncGenerator<AgentOutput, RunResult, string | undefined>;
}

export type RunResult = Result<AgentOutput, string>;

export enum PromptType {
  None,
  Prompt,
  Question,
}
