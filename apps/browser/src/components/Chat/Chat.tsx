import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from "react";
import { Evo } from "@evo-ninja/core";
import ReactMarkdown from "react-markdown";

import "./Chat.css";

export interface ChatMessage {
  text: string;
  user: string;
}

export interface ChatProps {
  evo: Evo;
  onMessage: (message: ChatMessage) => void;
  messages: ChatMessage[];
}

const Chat: React.FC<ChatProps> = ({ evo, onMessage, messages }: ChatProps) => {
  const [message, setMessage] = useState<string>("");
  const [evoRunning, setEvoRunning] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [evoItr, setEvoItr] = useState<ReturnType<Evo["run"]> | undefined>(
    undefined
  );

  useEffect(() => {
    const runEvo = async () => {
      if (!evoRunning) {
        return Promise.resolve();
      }

      // Create a new iteration thread
      if (!evoItr) {
        setEvoItr(evo.run(message));
        return Promise.resolve();
      }

      let messageLog = messages;

      while (evoRunning) {
        const response = await evoItr.next();

        if (response.value && response.value.message) {
          const evoMessage = {
            text: response.value.message,
            user: "evo"
          };
          messageLog = [...messageLog, evoMessage];
          onMessage(evoMessage);
        }

        if (response.done) {
          setEvoRunning(false);
          setSending(false); // Reset the sending state when done
          return Promise.resolve();
        }
      }
      return Promise.resolve();
    }

    runEvo();
  }, [evoRunning, evoItr]);

  const handleSend = async () => {
    setSending(true); // Set the sending state when starting to send
    setMessage("");
    onMessage({
      text: message,
      user: 'user'
    });
    setEvoRunning(true);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMessage(event.target.value);
  };

  const handleKeyPress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !sending) {
      handleSend();
    }
  };

  return (
    <div className="Chat">
      <div className="Messages">
        {messages.map((msg, index) => (
          <div key={index} className={`MessageContainer ${msg.user}`}>
            <div className="SenderName">{msg.user.toUpperCase()}</div>
            <div className={`Message ${msg.user}`}>
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
      <div className="Chat__Container">
        <input
          type="text"
          value={message}
          onChange={handleChange}
          onKeyPress={handleKeyPress}
          placeholder="Enter your main goal here..."
          className="Chat__Input"
          disabled={sending} // Disable input while sending
        />
        {sending ? (
          <div className="Spinner" />
        ) : (
          <button className="Chat__Btn" onClick={handleSend} disabled={evoRunning || sending}>
            Send
          </button>
        )}
      </div>
    </div>
  );
};

export default Chat;
