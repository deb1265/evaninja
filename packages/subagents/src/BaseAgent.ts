import { Agent, AgentFunctionResult, AgentOutput, Chat, ChatRole, Env, ExecuteAgentFunctionCalled, LlmApi, Logger, RunResult, Workspace, basicFunctionCallLoop } from "@evo-ninja/agent-utils";
import { AgentFunction } from "./types";
import { Result, ResultErr } from "@polywrap/result";

export interface BaseAgentContext {
  llm: LlmApi;
  chat: Chat;
  logger: Logger;
  workspace: Workspace;
  env: Env;
}

export interface BaseAgentConfig<TRunArgs, TBaseAgentContext> {
  name: string;
  initialMessages: (agentName: string, runArguments: TRunArgs) => { role: ChatRole; content: string }[];
  loopPreventionPrompt: string;
  functions: Record<string, {
    definition: AgentFunction;
    buildExecutor: (context: TBaseAgentContext) => (params: any) => Promise<Result<AgentFunctionResult, string>>;
  }>;
  shouldTerminate: (functionCalled: ExecuteAgentFunctionCalled) => boolean;
}

export abstract class BaseAgent<TRunArgs, TBaseAgentContext extends BaseAgentContext> implements Agent<TRunArgs> {
  constructor(
    private config: BaseAgentConfig<TRunArgs, TBaseAgentContext>,
    private context: TBaseAgentContext
  ) {}
  
  public get workspace(): Workspace {
    return this.context.workspace;
  }

  public async* run(
    args: TRunArgs
  ): AsyncGenerator<AgentOutput, RunResult, string | undefined> {
    const { chat } = this.context;
    try {
      this.config.initialMessages(this.config.name, args).forEach((message) => {
        chat.persistent(message.role, message.content);
      })

      // chat.persistent("system", INITIAL_PROMP);
      // chat.persistent("user", GOAL_PROMPT(namespace, description, args));

      const functionEntries = Object.entries(this.config.functions);
      const functions = functionEntries.map(([name, { definition, buildExecutor }]) => ({
        definition: {
          ...definition,
          name
        },
        buildExecutor
      }))

      return yield* basicFunctionCallLoop(
        this.context,
        functions,
        (functionCalled) => {
          return this.config.shouldTerminate(functionCalled);
        },
        this.config.loopPreventionPrompt
      );
    } catch (err) {
      this.context.logger.error(err);
      return ResultErr("Unrecoverable error encountered.");
    }
  }
}