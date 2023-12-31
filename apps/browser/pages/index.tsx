import React, { useState, useEffect } from "react";

import { InMemoryFile } from "@nerfzael/memory-fs";
import cl100k_base from "gpt-tokenizer/esm/encoding/cl100k_base";
import clsx from "clsx";
import DojoConfig from "../src/components/DojoConfig";
import DojoError from "../src/components/DojoError";
import Sidebar from "../src/components/Sidebar";
import Chat, { ChatMessage } from "../src/components/Chat";
import { updateWorkspaceFiles } from "../src/updateWorkspaceFiles";
import {
  AgentContext,
  Evo,
  SubWorkspace,
  InMemoryWorkspace,
  Logger,
  ConsoleLogger,
  Scripts,
  Env,
  OpenAIChatCompletion,
  LlmModel,
  Chat as EvoChat,
} from "@evo-ninja/agents";
import { createInBrowserScripts } from "../src/scripts";
import WelcomeModal, { WELCOME_MODAL_SEEN_STORAGE_KEY } from "../src/components/WelcomeModal";
import { BrowserLogger } from "../src/sys/logger";
import { checkLlmModel } from "../src/checkLlmModel";

function Dojo() {
  const [dojoConfig, setDojoConfig] = useState<{
    openAiApiKey: string | null;
    loaded: boolean;
    complete: boolean;
  }>({
    openAiApiKey: null,
    loaded: false,
    complete: false
  });
  const [welcomeModalOpen, setWelcomeModalOpen] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [dojoError, setDojoError] = useState<unknown | undefined>(undefined);
  const [evo, setEvo] = useState<Evo | undefined>(undefined);
  const [userFiles, setUserFiles] = useState<InMemoryFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<InMemoryFile[]>([]);
  const [userWorkspace, setUserWorkspace] = useState<
    InMemoryWorkspace | undefined
  >(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // TODO: setGoalEnded is unused?
  const [goalEnded, setGoalEnded] = useState<boolean>(false);

  useEffect(() => {
    if (window.innerWidth <= 1024) {
      setSidebarOpen(false);
    }
    const openAiApiKey = localStorage.getItem("openai-api-key");
    const complete = !!openAiApiKey;
    setDojoConfig({
      openAiApiKey,
      loaded: true,
      complete
    });
  }, []);

  useEffect(() => {
    const firstVisit = localStorage.getItem(WELCOME_MODAL_SEEN_STORAGE_KEY);
    if (!firstVisit) {
      localStorage.setItem(WELCOME_MODAL_SEEN_STORAGE_KEY, "true");
      setWelcomeModalOpen(true);
    }
  }, [])

  function checkForUserFiles() {
    if (!evo || !userWorkspace) {
      return;
    }
    updateWorkspaceFiles(userWorkspace, userFiles, setUserFiles);
  }

  function onMessage(message: ChatMessage) {
    setMessages((messages) => [...messages, message]);
    checkForUserFiles();
  }

  useEffect(() => {
    if (!evo || !userWorkspace) {
      return;
    }

    for (const file of uploadedFiles) {
      userWorkspace.writeFileSync(
        file.path,
        new TextDecoder().decode(file.content)
      );
    }

    checkForUserFiles();
  }, [uploadedFiles]);

  const onConfigSaved = (apiKey: string) => {
    let complete = true;
    let openAiApiKey = apiKey;

    if (!openAiApiKey) {
      complete = false;
      localStorage.removeItem("openai-api-key");
    } else {
      localStorage.setItem("openai-api-key", openAiApiKey);
    }

    setDojoConfig({
      openAiApiKey,
      loaded: true,
      complete
    });
    setConfigOpen(false);
  };

  useEffect(() => {
    (async () => {
      try {
        if (!dojoConfig.loaded || !dojoConfig.complete) {
          return;
        }
        setDojoError(undefined);

        const browserLogger = new BrowserLogger({
          onLog: (message: string) => {
            onMessage({
              user: "evo",
              title: message,
            });
          },
        });
        const logger = new Logger([browserLogger, new ConsoleLogger()], {
          promptUser: () => Promise.resolve("N/A"),
        });

        const scriptsWorkspace = createInBrowserScripts();
        const scripts = new Scripts(scriptsWorkspace);

        // Point by default to GPT-4 unless the given api key's account doesn't support it
        let model = "gpt-4"
        try {
          model = await checkLlmModel(dojoConfig.openAiApiKey as string, model);
        } catch (e: any) {
          if (e.message.includes("Incorrect API key provided")) {
            setDojoError("Open AI API key is not correct. Please make sure it has the correct format")
            return
          }
        }

        const env = new Env({
          OPENAI_API_KEY: dojoConfig.openAiApiKey as string,
          GPT_MODEL: model,
          CONTEXT_WINDOW_TOKENS: "8000",
          MAX_RESPONSE_TOKENS: "2000",
        });

        const llm = new OpenAIChatCompletion(
          env.OPENAI_API_KEY,
          env.GPT_MODEL as LlmModel,
          env.CONTEXT_WINDOW_TOKENS,
          env.MAX_RESPONSE_TOKENS,
          logger
        );

        const userWorkspace = new InMemoryWorkspace();
        setUserWorkspace(userWorkspace);

        const internals = new SubWorkspace(".evo", userWorkspace);

        const chat = new EvoChat(cl100k_base);

        setEvo(
          new Evo(
            new AgentContext(
              llm,
              chat,
              logger,
              userWorkspace,
              internals,
              env,
              scripts
            )
          )
        );
      } catch (err) {
        setDojoError(err);
      }
    })();
  }, [dojoConfig]);

  return (
    <>
      <div className="flex h-full bg-neutral-800 bg-landing-bg bg-repeat text-center text-neutral-400">
        {(((dojoConfig.loaded && !dojoConfig.complete) || configOpen) && !welcomeModalOpen) && (
          <DojoConfig
            apiKey={dojoConfig.openAiApiKey}
            onConfigSaved={onConfigSaved}
          />
        )}
        <div className={clsx(
          "relative w-full lg:w-auto lg:max-w-md",
          {
            hidden: !sidebarOpen,
          },
        )}>
          <Sidebar
            onSidebarToggleClick={() => {
              setSidebarOpen(!sidebarOpen);
            }}
            onSettingsClick={() => setConfigOpen(true)}
            userFiles={userFiles}
            onUploadFiles={setUploadedFiles}
          />
        </div>
        <div className={clsx("relative grow border-l-2 border-neutral-700", {
          "max-lg:hidden": sidebarOpen,
        })}>
          <>
            {dojoError ? <DojoError error={dojoError} /> : evo && (
              <Chat
                evo={evo}
                onMessage={onMessage}
                messages={messages}
                goalEnded={goalEnded}
                sidebarOpen={sidebarOpen}
                onSidebarToggleClick={() => {
                  setSidebarOpen(!sidebarOpen);
                }}
                onUploadFiles={setUploadedFiles}
              />
            )}
          </>
        </div>
      </div>
      <WelcomeModal isOpen={welcomeModalOpen} onClose={() => {
        setWelcomeModalOpen(false);
      }} />
    </>
  );
}

export default Dojo;
