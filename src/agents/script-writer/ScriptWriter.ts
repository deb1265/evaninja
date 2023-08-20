import { loop } from "./loop";
import { agentFunctions } from "./agent-functions";
import { RunResult, StepOutput, Agent } from "../agent";
import { executeAgentFunction } from "../agent-function";
import { WrapClient } from "../../wrap";
import { LlmApi, OpenAI, Chat } from "../../llm";
import { Workspace, env } from "../../sys";

export class ScriptWriter implements Agent {
  public chat: Chat;
  private llm: LlmApi;

  private client: WrapClient;
  private globals: Record<string, any> = {};

  constructor(private readonly workspace: Workspace) {
    this.llm = new OpenAI(
      env().OPENAI_API_KEY,
      env().GPT_MODEL
    );

    this.chat = new Chat(
      env().CONTEXT_WINDOW_TOKENS,
      this.workspace,
      this.llm as OpenAI
    );

    this.client = new WrapClient(
      this.workspace,
    );
    
    this.globals = {};
  }

  public async* run(
    namespace: string, 
    description: string,
    args: string,
    developerNote?: string
  ): AsyncGenerator<StepOutput, RunResult, string | undefined> {
    try {
      return yield* loop(
        namespace, 
        description, 
        args, 
        developerNote,
        this.llm, 
        this.chat, 
        this.client, 
        this.globals,
        this.workspace,
        executeAgentFunction,
        agentFunctions
      );
    } catch (err) {
      console.error(err);
      return RunResult.error( "Unrecoverable error encountered.");
    }
  }
}