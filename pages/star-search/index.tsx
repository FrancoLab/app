import { GetServerSidePropsContext } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";
import { MdOutlineSubdirectoryArrowRight } from "react-icons/md";
import { forwardRef, useEffect, useRef, useState } from "react";

import Image from "next/image";
import Markdown from "react-markdown";
import { TrashIcon } from "@heroicons/react/24/outline";
import { BsArrowUpShort } from "react-icons/bs";
import { ThumbsdownIcon, ThumbsupIcon, XCircleIcon } from "@primer/octicons-react";
import { getAllFeatureFlags } from "lib/utils/server/feature-flags";
import Card from "components/atoms/Card/card";
import ProfileLayout from "layouts/profile";
import { getAvatarById } from "lib/utils/github";
import { ScrollArea } from "components/atoms/ScrollArea/scroll-area";
import { Drawer } from "components/shared/Drawer";
import { useMediaQuery } from "lib/hooks/useMediaQuery";
import SEO from "layouts/SEO/SEO";
import { StarSearchFeedbackAnalytic, useStarSearchFeedback } from "lib/hooks/useStarSearchFeedback";
import { useToast } from "lib/hooks/useToast";

const HEIGHT_TO_TAKE_OFF_SCROLL_AREA = 340;

const SUGGESTIONS = [
  {
    title: "Get information on contributor activity",
    prompt: "What type of pull requests has brandonroberts worked on?",
  },
  {
    title: "Identify key contributors",
    prompt: "Who are the most prevalent contributors to the Typescript ecosystem?",
  },
  {
    title: "Find contributors based on their work",
    prompt: "Who are people making pull requests in vercel/turbo about css modules?",
  },
  {
    title: "Find experts",
    prompt: "Who are the best developers that know Tailwind and are interested in Rust?",
  },
];

type SuggesionTypes = (typeof SUGGESTIONS)[number];

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const supabase = createPagesServerClient(context);
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userId = Number(session?.user.user_metadata.sub);
  const featureFlags = userId ? await getAllFeatureFlags(userId) : null;

  if (!userId || featureFlags == null || !featureFlags["star_search"]) {
    return { redirect: { destination: `/star-search/waitlist`, permanent: false } };
  }

  const ogImageUrl = `${new URL(
    "/assets/og-images/star-search-og-image.png",
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  )}`;

  return { props: { userId, bearerToken: session?.access_token, ogImageUrl } };
}

type StarSearchPageProps = {
  userId: number;
  bearerToken: string;
  ogImageUrl: string;
};

type StarSearchChat = {
  author: "You" | "StarSearch";
  content: string;
};

export default function StarSearchPage({ userId, bearerToken, ogImageUrl }: StarSearchPageProps) {
  const [starSearchState, setStarSearchState] = useState<"initial" | "chat">("initial");
  const [chat, setChat] = useState<StarSearchChat[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const isMobile = useMediaQuery("(max-width: 576px)");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { feedback } = useStarSearchFeedback();
  const { toast } = useToast();

  function registerFeedback(feedbackType: StarSearchFeedbackAnalytic["feedback"]) {
    feedback({
      feedback: feedbackType,
      promptContent: chat.filter(({ author }) => author === "You").map(({ content }) => content),
      promptResponse: chat.filter(({ author }) => author === "StarSearch").map(({ content }) => content),
    });
    toast({ description: "Thank you for your feedback!", variant: "success" });
  }

  function addPromptInput(prompt: string) {
    if (!inputRef.current?.form) {
      return;
    }

    inputRef.current.value = prompt;
    const { form } = inputRef.current;

    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, showSuggestions]);

  const submitPrompt = async (prompt: string) => {
    if (isRunning) {
      return;
    }
    if (starSearchState === "initial") {
      setStarSearchState("chat");
    }
    setIsRunning(true); // disables input

    // add user prompt to history
    setChat((history) => {
      const temp = history;
      temp.push({ author: "You", content: prompt });
      return temp;
    });

    // get ReadableStream from API
    const baseUrl = new URL(process.env.NEXT_PUBLIC_API_URL!);
    const response = await fetch(`${baseUrl}/star-search/stream`, {
      method: "POST",
      body: JSON.stringify({
        query_text: prompt,
      }),
      headers: {
        Accept: "*/*",
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    if (response.status !== 200) {
      setChat((history) => {
        const temp = history;
        temp.push({ author: "StarSearch", content: "There's been an error. Try again." });
        return temp;
      });
      setIsRunning(false); // enables input
      return;
    }

    setChat((history) => {
      const temp = history;
      temp.push({ author: "StarSearch", content: "" });
      return temp;
    });

    const decoder = new TextDecoderStream();
    const reader = response.body?.pipeThrough(decoder).getReader();
    while (true) {
      const { done, value } = await reader!.read();
      if (done) {
        setIsRunning(false); // enables input
        return;
      }
      const values = value.split("\n");
      values
        .filter((v) => v.startsWith("data:"))
        .forEach((v) => {
          const matched = v.match(/data:\s(?<result>.+)/);
          if (!matched || !matched.groups) {
            return;
          }
          const temp = [...chat];
          const changed = temp.at(temp.length - 1);
          changed!.content += matched.groups.result;
          setChat(temp);
        });
    }
  };

  const renderState = () => {
    switch (starSearchState) {
      case "initial":
        return (
          <div
            className="flex flex-col text-center items-center gap-4 lg:pt-12 mb-16"
            // style={{ maxHeight: `calc(100vh - ${HEIGHT_TO_TAKE_OFF_SUGGESTIONS}px)` }}
          >
            <Header />
            <SuggestionBoxes addPromptInput={addPromptInput} suggestions={SUGGESTIONS} />
          </div>
        );
      case "chat":
        return (
          <>
            <ScrollArea
              aria-live="polite"
              className="grow items-center flex flex-col w-full max-w-xl lg:max-w-5xl lg:px-8 mx-auto pb-4"
              style={{ maxHeight: `calc(100vh - ${HEIGHT_TO_TAKE_OFF_SCROLL_AREA}px)` }}
            >
              {chat.map((message, i) => (
                <Chatbox key={i} userId={userId} author={message.author} content={message.content} />
              ))}
              {!isRunning ? (
                <>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="flex gap-2 items-center hover:text-sauced-orange text-slate-600"
                      onClick={() => {
                        setStarSearchState("initial");
                        setChat([]);
                      }}
                    >
                      Clear chat history
                      <TrashIcon width={16} height={16} />
                    </button>
                  </div>
                  <div className="flex justify-end mb-4 gap-2 text-slate-600">
                    <span>Was this response useful?</span>
                    <button
                      type="button"
                      className="flex gap-2 items-center hover:text-sauced-orange"
                      onClick={() => {
                        registerFeedback("positive");
                      }}
                    >
                      <span className="sr-only">Thumbs up</span>
                      <ThumbsupIcon size={16} />
                    </button>
                    <button
                      type="button"
                      className="flex gap-2 items-center hover:text-sauced-orange"
                      onClick={() => {
                        registerFeedback("negative");
                      }}
                    >
                      <span className="sr-only">Thumbs down</span>
                      <ThumbsdownIcon size={16} />
                    </button>
                  </div>
                </>
              ) : null}
              <div ref={scrollRef} />
            </ScrollArea>
            {!isMobile && showSuggestions && (
              <div className="flex flex-col gap-2 mb-14">
                <button
                  onClick={() => {
                    setShowSuggestions(false);
                    inputRef.current?.focus();
                  }}
                  className="flex gap-2 w-fit self-end hover:text-sauced-orange focus-visible:text-sauced-orange focus-visible:ring focus-visible:border-orange-500 focus-visible:ring-orange-100"
                >
                  <XCircleIcon className="w-6 h-6" aria-label="Close suggestions" />
                </button>
                <SuggestionBoxes
                  isHorizontal
                  addPromptInput={(prompt) => {
                    addPromptInput(prompt);
                    setShowSuggestions(false);
                  }}
                  suggestions={SUGGESTIONS}
                />
              </div>
            )}
          </>
        );
    }
  };

  return (
    <>
      <SEO
        title="OpenSauced Insights - StarSearch"
        description="Copilot, but for git history"
        image={ogImageUrl}
        twitterCard="summary_large_image"
      />
      <ProfileLayout>
        <div className="relative -mt-1.5 flex flex-col p-4 lg:p-8 justify-between items-center w-full h-full grow bg-slate-50">
          {renderState()}
          <div className="absolute inset-x-0 bottom-2 flex flex-col gap-4 items-center w-full px-2">
            {!isRunning &&
              starSearchState === "chat" &&
              (isMobile ? (
                <Drawer
                  title="Choose a suggestion"
                  description="You can customize the prompt after selection"
                  showCloseButton
                  trigger={
                    <button className="z-30 flex gap-1 shadow-xs items-center text-slate-700 text-sm font-medium bg-slate-100 !border-2 !border-slate-300 px-4 py-1 rounded-full">
                      Need inspiration?
                      <BsArrowUpShort className="text-2xl" />
                    </button>
                  }
                >
                  <SuggestionBoxes addPromptInput={addPromptInput} suggestions={SUGGESTIONS} />
                </Drawer>
              ) : (
                <>
                  {!showSuggestions && (
                    <button
                      onClick={() => setShowSuggestions(!showSuggestions)}
                      className="z-30 mx-auto w-fit flex gap-1 shadow-xs items-center text-slate-700 font-medium bg-slate-100 !border-2 !border-slate-300 px-4 py-1 rounded-full"
                    >
                      Need inspiration?
                      <BsArrowUpShort className="text-2xl" />
                    </button>
                  )}
                </>
              ))}
            <StarSearchInput ref={inputRef} isRunning={isRunning} onSubmitPrompt={submitPrompt} />
          </div>
          <div className="absolute inset-x-0 top-0 z-0 h-[125px] w-full translate-y-[-100%] lg:translate-y-[-50%] rounded-full bg-gradient-to-r from-light-red-10 via-sauced-orange to-amber-400 opacity-40 blur-[40px]"></div>
        </div>
      </ProfileLayout>
    </>
  );
}

function Header() {
  return (
    <section className="flex flex-col text-center items-center gap-2 lg:gap-4 pt-4 lg:pt-24">
      <div className="flex gap-2 items-center">
        <Image src="/assets/star-search-logo.svg" alt="Star Search Logo" width={40} height={40} />
        <h1 className="text-3xl lg:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-sauced-orange to-amber-400">
          StarSearch
        </h1>
      </div>
      <h2 className="text-3xl lg:text-4xl font-semibold text-slate-600 pt-1">Ask questions about contributors</h2>
    </section>
  );
}

function SuggestionBoxes({
  addPromptInput,
  isHorizontal,
  suggestions,
}: {
  addPromptInput: (prompt: string) => void;
  isHorizontal?: boolean;
  suggestions: SuggesionTypes[];
}) {
  return (
    <div
      className={`${
        isHorizontal ? "flex overflow-x-scroll snap-x" : "grid grid-cols-1 lg:grid-cols-2 place-content-center"
      } gap-2 lg:gap-4 w-full max-w-3xl`}
    >
      {suggestions.map((suggestion, i) => (
        <button key={i} onClick={() => addPromptInput(suggestion.prompt)}>
          <Card
            className={`${
              isHorizontal ? "w-[30rem] snap-start" : "w-full h-fit"
            } shadow-md border-none text-start !p-6 text-slate-600`}
          >
            <h3 className="text-sm lg:text-base font-semibold">{suggestion.title}</h3>
            <p className="text-xs lg:text-sm">{suggestion.prompt}</p>
          </Card>
        </button>
      ))}
    </div>
  );
}

function Chatbox({ author, content, userId }: StarSearchChat & { userId?: number }) {
  const renderAvatar = () => {
    switch (author) {
      case "You":
        return (
          <Image
            src={getAvatarById(`${userId}`)}
            alt="Your profile picture"
            width={32}
            height={32}
            className="w-8 h-8 lg:w-10 lg:h-10 rounded-full"
          />
        );
      case "StarSearch":
        return (
          <div className="bg-gradient-to-br from-sauced-orange to-amber-400 px-1.5 py-1 lg:p-2 rounded-full">
            <Image
              src="/assets/star-search-logo-white.svg"
              alt="StarSearch logo"
              width={24}
              height={24}
              className="w-6 h-6"
            />
          </div>
        );
    }
  };

  return (
    <li className="flex gap-2 justify-center items-start my-4 w-full">
      {renderAvatar()}
      <Card className="flex flex-col grow bg-white z-10 p-2 lg:p-4 w-full max-w-xl lg:max-w-5xl [&_a]:text-sauced-orange [&_a:hover]:underline">
        <h3 className="font-semibold text-sauced-orange">{author}</h3>
        <Markdown>{content}</Markdown>
      </Card>
    </li>
  );
}

const StarSearchInput = forwardRef<
  HTMLInputElement,
  {
    isRunning: boolean;
    onSubmitPrompt: (prompt: string) => void;
  }
>(function StarSearchInput({ isRunning, onSubmitPrompt }, ref) {
  return (
    <section className="mx-0.5 lg:mx-auto w-full lg:max-w-3xl px-1 py-[3px] rounded-xl bg-gradient-to-r from-sauced-orange via-amber-400 to-sauced-orange">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const formData = new FormData(form);
          onSubmitPrompt(formData.get("prompt") as string);
          form.reset();
        }}
        className="w-full bg-white h-fit flex justify-between rounded-lg"
      >
        <input
          required
          type="text"
          name="prompt"
          ref={ref}
          disabled={isRunning}
          placeholder="Ask a question"
          className="p-4 border bg-white focus:outline-none grow rounded-l-lg border-none"
        />
        <button type="submit" disabled={isRunning} className="bg-white p-2 rounded-r-lg">
          <MdOutlineSubdirectoryArrowRight className="rounded-lg w-10 h-10 p-2 bg-light-orange-3 text-light-orange-10" />
        </button>
      </form>
    </section>
  );
});
