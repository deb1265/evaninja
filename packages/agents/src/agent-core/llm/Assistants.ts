import { OpenAI } from "openai"
import { Blob } from 'fetch-blob';
import { File } from 'fetch-blob/file.js'
import { LlmApi, LlmOptions } from "./LlmApi";
import { Workspace } from "@evo-ninja/agent-utils";
import { RequiredActionFunctionToolCall, RunSubmitToolOutputsParams } from "openai/resources/beta/threads/runs/runs";
import {
  Assistant,
  AssistantCreateParams,
} from "openai/resources/beta/assistants/assistants";
import { ThreadCreateParams } from "openai/resources/beta/threads/threads";
import { ChatLogs } from "./chat";
import { FunctionDefinition } from "./ChatCompletion";

interface RunThreadOptions {
  assistantId: string;
  instructions?: string;
  goal: string;
}

interface AssistantOptions {
  name: string;
  persona: string;
  fileIds?: string[];
  functions?: AssistantCreateParams.AssistantToolsFunction["function"][];
}

export class OpenAIAssistants implements LlmApi {
  private _api: OpenAI;
  private _id: string;

  constructor(
    private _apiKey: string,
    private _workspace: Workspace,
    private _config: {
      pollingTimeout: number;
    },
    _id?: string,
  ) {
    this._api = new OpenAI({
      apiKey: this._apiKey,
      dangerouslyAllowBrowser: true
    });
  }
  
  getMaxContextTokens(): number {
    throw new Error("Method not implemented.");
  }
  getMaxResponseTokens(): number {
    throw new Error("Method not implemented.");
  }
  getModel(): string {
    throw new Error("Method not implemented.");
  }

  private executeFunction = async (tool: RequiredActionFunctionToolCall): Promise<{ name: string; id: string; output?: string }> => {
    throw new Error("Method not implemented.");
  }

  async getResponse(
    chatLog: ChatLogs,
    functionDefinitions?: FunctionDefinition[],
    options?: LlmOptions
  ) {
    let run = await this.runThread(options.threadId, this._id);

    while (run.status !== "completed") {
      if (["cancelled", "failed", "expired"].includes(run.status)) {
        throw new Error("Run couldn't be completed because of status: " + run.status);
      }

      if (run.status === "requires_action") {
        await this.handleRequiredAction(run);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      run = await this.runThread(options.threadId, this._id);
    }

    return await this.waitForAssistantMessage(run.thread_id);
  }

  async handleRequiredAction(run: OpenAI.Beta.Threads.Runs.Run) {
      if (!run.required_action) throw new Error("No required action");

      const tools = run.required_action.submit_tool_outputs.tool_calls;

      try {
        const toolOutputs = await this.processToolCalls(tools);
        await this._api.beta.threads.runs.submitToolOutputs(run.thread_id, run.id, { tool_outputs: toolOutputs });
      } catch (e) {
        console.log("Error: ", e.message);
      }
  }

  async processToolCalls(tools: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[]) {
      const results = await Promise.all(tools.map(this.executeFunction));
      return results.map(({ id, output }) => ({ tool_call_id: id, output }));
  }

  async waitForAssistantMessage(threadId: string): Promise<OpenAI.Beta.Threads.Messages.ThreadMessage> {
    let messages = await this.getMessages(threadId);
    let lastMessage = messages.slice(-1)[0];

    if (lastMessage.role === "assistant") {
      return lastMessage;
    }

    await new Promise((resolve) => setTimeout(resolve, this._config.pollingTimeout));
    return await this.waitForAssistantMessage(threadId);
  }

  async getAssistant(opts: {
    id?: string;
    name?: string;
  }): Promise<Assistant | void> {
    const assistants = await this._api.beta.assistants.list();
    if (opts.id) {
      const assistant = assistants.data.find(({ id }) => id == opts.id);
      if (assistant) return assistant;
    }
  
    if (opts.name) {
      const assistant = assistants.data.find(({ name }) => name == opts.name);
      if (assistant) return assistant;
    }
  };
  
  async createAssistant({
    name,
    persona,
    fileIds,
    functions,
  }: AssistantOptions) {
    console.log("Creating assistant....");
  
    const tools: AssistantCreateParams["tools"] = [];
  
    if (fileIds) {
      tools.push({ type: "retrieval" });
    }
  
    if (functions) {
      for (let i = 0; i < functions.length; i++) {
        tools.push({ type: "function", function: functions[i] });
      }
    }
  
    const assistant = await this._api.beta.assistants.create({
      name,
      instructions: persona,
      tools,
      model: "gpt-4-1106-preview",
      file_ids: fileIds,
    });
    console.log(`Assistant ${name} created`);
    return assistant;
  };
  
  async runThread(threadId: string, assistantId: string) {
    const run = await this._api.beta.threads.runs.create(threadId, {
      assistant_id: assistantId,
    });
    return run;
  };
  
  async createThread(goal?: string) {
    let messages: ThreadCreateParams.Message[] = [];
    if (goal) {
      messages.push({
        role: "user",
        content: goal,
      });
    }
    return await this._api.beta.threads.create({
      messages,
    });
  };
  
  async addMessage(threadId: string, content: string) {
    await this._api.beta.threads.messages.create(threadId, {
      content,
      role: "user",
    });
  };
  
  async createThreadAndRun(options: RunThreadOptions) {
    const thread = await this._api.beta.threads.createAndRun({
      assistant_id: options.assistantId,
      instructions: options.instructions,
      thread: {
        messages: [
          {
            role: "user",
            content: options.goal,
          },
        ],
      },
    });
  
    return thread;
  };
  
  async addFile(args: { path: string; name: string }) {
    const fileContent = this._workspace.readFileSync(args.path);
    const blob = new Blob([fileContent], { type: 'text/plain' });
    const file = new File([blob], args.name, { type: 'text/plain' })

    const createdFile = await this._api.files.create({
      file,
      purpose: "assistants",
    });
    return createdFile.id;
  };
  
  async getMessages(threadId: string) {
    const messages = await this._api.beta.threads.messages.list(threadId);
    return messages.data;
  };
  
  async getThread(threadId: string) {
    return await this._api.beta.threads.retrieve(threadId);
  };
  
  async getRun(threadId: string, runId: string) {
    return await this._api.beta.threads.runs.retrieve(threadId, runId);
  };
  
  async submitResponses(
    threadId: string,
    runId: string,
    toolOutputs: RunSubmitToolOutputsParams["tool_outputs"]
  ) {
    await this._api.beta.threads.runs.submitToolOutputs(threadId, runId, {
      tool_outputs: toolOutputs,
    });
  };
}