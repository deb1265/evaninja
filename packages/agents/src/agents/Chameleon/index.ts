import {
  AgentFunction,
  ChatLogs,
  ChatMessage,
  FunctionDefinition,
  MessageChunker,
  TextChunker,
  Timeout,
  Tokenizer,
  Workspace,
  LocalVectorDB,
  OpenAIEmbeddingAPI,
  ContextualizedChat,
  Chat
} from "@evo-ninja/agent-utils";
import { AgentContext } from "../../AgentContext";
import { agentPrompts, prompts } from "./prompts";
import { GoalRunArgs } from "../../Agent";
import { AgentConfig } from "../../AgentConfig";
import { Rag } from "./Rag";
import { Prompt } from "./Prompt";
import { NewAgent } from "./NewAgent";
import { charsToTokens, previewChunks } from "./helpers";
import { findBestAgent } from "./findBestAgent";

export class ChameleonAgent extends NewAgent<GoalRunArgs> {
  private _cChat: ContextualizedChat;
  private _chunker: MessageChunker;
  private lastQuery: string = "";

  constructor(
    context: AgentContext,
    timeout?: Timeout,
  ) {
    super(
      new AgentConfig(
        agentPrompts,
        [],
        context.scripts,
        timeout
      ),
      context,
    );
    this._chunker = new MessageChunker({ maxChunkSize: context.variables.saveThreshold });
    const embeddingApi = new OpenAIEmbeddingAPI(
      this.context.env.OPENAI_API_KEY,
      this.context.logger,
      this.context.chat.tokenizer
    );
    this._cChat = new ContextualizedChat(
      this.context.chat,
      this._chunker,
      new LocalVectorDB(this.context.internals, "cchat", embeddingApi),
      context.variables
    );
  }

  protected initializeChat(args: GoalRunArgs): void {
    const { chat } = this.context;

    chat.persistent(buildDirectoryPreviewMsg(this.context.workspace));
    chat.persistent("user", prompts.exhaustAllApproaches);
    chat.persistent("user", prompts.variablesExplainer);
    chat.persistent("user", args.goal);
  }

  protected async beforeLlmResponse(): Promise<{ logs: ChatLogs, agentFunctions: FunctionDefinition[], allFunctions: AgentFunction<AgentContext>[]}> {

    // Retrieve the last message
    const rawChatLogs = this.context.chat.chatLogs;
    const lastMessages = [
      { role: "user", content: prompts.generalAgentPersona },
      rawChatLogs.getMsg("persistent", -1),
      rawChatLogs.getMsg("temporary", -2),
      rawChatLogs.getMsg("temporary", -1)
    ].filter((x) => x !== undefined) as ChatMessage[];

    // Summarize large messages
    for (let i = 0; i < lastMessages.length; ++i) {
      const msg = lastMessages[i];
      if (this._chunker.shouldChunk(msg)) {
        const content = await this.advancedFilterText(
          msg.content || "",
          this.lastQuery
        );
        lastMessages[i] = { ...msg, content };
      }
    }

    // Predict the next step
    const prediction = await this.askLlm(
      new Prompt()
        .json(lastMessages)
        .line(`
          Consider the above chat between a user and assistant.
          In your expert opinion, what is the best next step for the assistant?`
        )
    );

    const [agent, agentFunctions, persona, allFunctions] = await findBestAgent(prediction, this.context);

    const context = `${persona}\n${prediction}`;
    const maxContextTokens = this.context.llm.getMaxContextTokens();
    const maxResponseTokens = this.context.llm.getMaxResponseTokens();
    // TODO: remove this once we properly track function definition tokens
    const fuzz = 500;
    const maxChatTokens = maxContextTokens - maxResponseTokens - fuzz;

    const contextualizedChat = await this._cChat.contextualize(
      context, {
        persistent: maxChatTokens * 0.25,
        temporary: maxChatTokens * 0.75
      }
    );

    prependAgentMessages(
      agent.config,
      contextualizedChat
    );

    return {
      logs: contextualizedChat.chatLogs,
      agentFunctions,
      allFunctions: allFunctions.map((fn: any) => {
        return {
          definition: fn.getDefinition(),
          buildExecutor: (context: AgentContext) => {
            return fn.buildExecutor(agent);
          }
        }
      })
    }
  }

  protected async beforeLlmResponse0(): Promise<{ logs: ChatLogs, agentFunctions: FunctionDefinition[], allFunctions: AgentFunction<AgentContext>[]}> {
    const { chat } = this.context;
    const { messages } = chat.chatLogs;

    const lastMessage = messages.slice(-1)[0];

    if (isLargeMsg(lastMessage)) {
      await this.shortenMessage(lastMessage, this.lastQuery);
    }

    const prediction = await this.predictBestNextStep(messages);

    this.lastQuery = prediction;
    console.log("Prediction: ", prediction);

    await this.shortenLargeMessages(prediction);

    const [agent, agentFunctions, persona, allFunctions] = await findBestAgent(prediction, this.context);

    const logs = insertPersonaAsFirstMsg(persona, chat.chatLogs, chat.tokenizer);

    return {
      logs,
      agentFunctions,
      allFunctions: allFunctions.map((fn: any) => {
        return {
          definition: fn.getDefinition(),
          buildExecutor: (context: AgentContext) => {
            return fn.buildExecutor(agent);
          }
        }
      })
    }
  }

  private async predictBestNextStep(messages: ChatMessage[]): Promise<string> {
    //TODO: Keep persona in chat logs when doing this
    return await this.askLlm(
      new Prompt()
        .json([
          { role: "user", content: prompts.generalAgentPersona }, 
          ...messages
        ])
        .line(`
          Consider the above chat between a user and assistant.
          In your expert opinion, what is the best next step for the assistant?`
        )
    );
  };

  private async shortenLargeMessages(query: string): Promise<void> {
    for(let i = 2; i < this.context.chat.chatLogs.messages.length ; i++) {
      const message = this.context.chat.chatLogs.messages[i];
      if (isLargeMsg(message)) {
        await this.shortenMessage(message, query);
      }
    }
  }

  private async shortenMessage(message: ChatMessage, query: string): Promise<void> {
    message.content = await this.advancedFilterText(message.content ?? "", query);
  }

  // private async filterText(text: string, query: string, context: AgentContext): Promise<string> {
  //   const chunks = TextChunker.parentDocRetrieval(text, {
  //     parentChunker: (text: string) => TextChunker.sentences(text),
  //     childChunker: (parentText: string) =>
  //       TextChunker.fixedCharacterLength(parentText, { chunkLength: 100, overlap: 15 })
  //   });

  //   const result = await Rag.standard(chunks, context)
  //     .selector(x => x.doc)
  //     .limit(12)
  //     .sortByIndex()
  //     .onlyUnique()
  //     .query(query);

  //   return previewChunks(
  //     result.map(x => x.metadata.parent),
  //     maxContextChars(context) * 0.07
  //   );
  // }

  private async advancedFilterText(text: string, query: string): Promise<string> {
    const chunks = TextChunker.parentDocRetrieval(text, {
      parentChunker: (text: string) => TextChunker.sentences(text),
      childChunker: (parentText: string) =>
        TextChunker.fixedCharacterLength(parentText, { chunkLength: 100, overlap: 15 })
    });
    const result = await Rag.standard(chunks, this.context)
      .selector(x => x.doc)
      .limit(48)
      .sortByIndex()
      .onlyUnique()
      .query(query);

    const maxCharsToUse = this.maxContextChars() * 0.5;
    const charsForPreview = maxCharsToUse * 0.7;

    const bigPreview = previewChunks(
      result.map(x => x.metadata.parent),
      charsForPreview
    );

    const prompt = new Prompt()
      .block(bigPreview)
      .line(`Goal:`)
      .line(x => x.block(query))
      .line(`
        Consider the above text in respect to the desired goal.
        Rewrite the text to better achieve the goal.
        Filter out unecessary information. Do not add new information.
        IMPORTANT: Respond only with the new text!`
      ).toString();

    const filteredText = await this.askLlm(prompt, charsToTokens(maxCharsToUse - prompt.length));

    console.log("filteredText", text);

    return filteredText;
  }

  private maxContextChars(): number {
    return this.context.llm.getMaxContextTokens() ?? 8000;
  }
}

const insertPersonaAsFirstMsg = (persona: string, logs: ChatLogs, tokenizer: Tokenizer): ChatLogs => {
  const newLogs = logs.clone();
  newLogs.insert("persistent",
    [{
      role: "user",
      content: persona,
    } as ChatMessage],
    [tokenizer.encode(persona).length],
    0
  );

  return newLogs;
};

const isLargeMsg = (message: ChatMessage): boolean => {
  return !!message.content && message.content.length > 2000;
}

const buildDirectoryPreviewMsg = (workspace: Workspace): ChatMessage => {
  const files = workspace.readdirSync("./");
  return {
    role: "user",
    content: `Current directory: './'
Files: ${
files.filter((x) => x.type === "file").map((x) => x.name).join(", ")
}\nDirectories: ${
files.filter((x) => x.type === "directory").map((x) => x.name).join(", ")
}` 
  }
};

function prependAgentMessages(agent: AgentConfig<unknown>, chat: Chat): void {
  // TODO: refactor the AgentConfig to only include the agent's prompt, assume goal will be added
  const msgs = agent.prompts.initialMessages({ goal: "foo bar remove me" }).slice(0, -1);
  chat.chatLogs.insert(
    "persistent",
    msgs,
    msgs.map((msg) => chat.tokenizer.encode(msg.content || "").length),
    0
  );
}
