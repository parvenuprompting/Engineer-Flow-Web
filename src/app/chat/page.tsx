"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BrainCircuit,
  CloudUpload,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  User,
  AlertTriangle,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import type { Message } from "@/ai/flows/types";
import { useFirestore, useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import { getExpertChatResponse } from "../actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const LEGACY_CHAT_HISTORY_STORAGE_KEY = "expertChatHistory";
const CHAT_CONVERSATIONS_STORAGE_KEY = "expertChatConversationsV2";
const CHAT_ACTIVE_CONVERSATION_STORAGE_KEY = "expertChatActiveConversationIdV2";
const DEFAULT_TITLE = "Nieuw gesprek";

type PersistedMessage = Pick<Message, "role" | "content">;

interface ChatConversation {
  id: string;
  title: string;
  messages: PersistedMessage[];
  createdAt: string;
  updatedAt: string;
  cloudDocId?: string;
  cloudSavedAt?: string;
}

function isChatConversation(value: ChatConversation | null): value is ChatConversation {
  return value !== null;
}

function createConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `conv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeMessages(input: unknown): PersistedMessage[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const maybeRole = (item as { role?: unknown }).role;
      const maybeContent = (item as { content?: unknown }).content;
      if (typeof maybeContent !== "string") return null;
      if (maybeRole !== "user" && maybeRole !== "model" && maybeRole !== "system" && maybeRole !== "tool") {
        return null;
      }
      return { role: maybeRole, content: maybeContent } as PersistedMessage;
    })
    .filter((msg): msg is PersistedMessage => msg !== null);
}

function deriveConversationTitle(messages: PersistedMessage[]): string {
  const firstUserMessage = messages.find((msg) => msg.role === "user" && msg.content.trim().length > 0);
  if (!firstUserMessage) return DEFAULT_TITLE;

  const cleaned = firstUserMessage.content.trim().replace(/\s+/g, " ");
  return cleaned.length > 48 ? `${cleaned.slice(0, 48)}...` : cleaned;
}

function createConversation(initialMessages: PersistedMessage[] = []): ChatConversation {
  const now = nowIso();
  return {
    id: createConversationId(),
    title: deriveConversationTitle(initialMessages),
    messages: initialMessages,
    createdAt: now,
    updatedAt: now,
  };
}

function formatDateLabel(value: unknown): string {
  let date: Date | null = null;

  if (value instanceof Date) {
    date = value;
  } else if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate?: unknown }).toDate === "function") {
    date = ((value as { toDate: () => Date }).toDate());
  } else if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date) return "Onbekend";

  return date.toLocaleString("nl-NL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [cloudSessions, setCloudSessions] = useState<any[]>([]);
  const [isCloudSessionsLoading, setIsCloudSessionsLoading] = useState(false);
  const [cloudArchiveBlocked, setCloudArchiveBlocked] = useState(false);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const sortedConversations = useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [conversations]
  );

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId]
  );

  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    if (!user) {
      setCloudSessions([]);
      setCloudArchiveBlocked(false);
      setIsCloudSessionsLoading(false);
      return;
    }

    setIsCloudSessionsLoading(true);
    setCloudArchiveBlocked(false);

    const sessionsCol = collection(firestore, "chat_sessions", user.uid, "sessions");
    const sessionsQuery = query(sessionsCol, orderBy("updatedAt", "desc"));

    const unsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCloudSessions(rows);
        setIsCloudSessionsLoading(false);
      },
      (snapshotError: { code?: string; message?: string }) => {
        console.warn("Chat cloud archive query failed:", snapshotError);
        setCloudSessions([]);
        setIsCloudSessionsLoading(false);
        setCloudArchiveBlocked(true);
      }
    );

    return () => unsubscribe();
  }, [firestore, user]);

  useEffect(() => {
    try {
      const rawConversations = localStorage.getItem(CHAT_CONVERSATIONS_STORAGE_KEY);
      const rawActiveConversation = localStorage.getItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY);

      if (rawConversations) {
        const parsed = JSON.parse(rawConversations);
        if (Array.isArray(parsed)) {
          const restored = parsed
            .map<ChatConversation | null>((item) => {
              if (!item || typeof item !== "object") return null;
              const candidate = item as Partial<ChatConversation>;
              if (typeof candidate.id !== "string") return null;

              const msgs = sanitizeMessages(candidate.messages);
              const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : nowIso();
              const updatedAt = typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt;
              const title = typeof candidate.title === "string" && candidate.title.trim().length > 0
                ? candidate.title
                : deriveConversationTitle(msgs);

              return {
                id: candidate.id,
                title,
                messages: msgs,
                createdAt,
                updatedAt,
                cloudDocId: typeof candidate.cloudDocId === "string" ? candidate.cloudDocId : undefined,
                cloudSavedAt: typeof candidate.cloudSavedAt === "string" ? candidate.cloudSavedAt : undefined,
              } satisfies ChatConversation;
            })
            .filter(isChatConversation);

          if (restored.length > 0) {
            setConversations(restored);
            const preferredActiveId = rawActiveConversation && restored.some((conv) => conv.id === rawActiveConversation)
              ? rawActiveConversation
              : restored[0].id;
            setActiveConversationId(preferredActiveId);
            setIsHydrated(true);
            return;
          }
        }
      }

      const legacyHistoryRaw = localStorage.getItem(LEGACY_CHAT_HISTORY_STORAGE_KEY);
      if (legacyHistoryRaw) {
        const legacyMessages = sanitizeMessages(JSON.parse(legacyHistoryRaw));
        const migratedConversation = createConversation(legacyMessages);
        setConversations([migratedConversation]);
        setActiveConversationId(migratedConversation.id);
        localStorage.removeItem(LEGACY_CHAT_HISTORY_STORAGE_KEY);
      } else {
        const initialConversation = createConversation();
        setConversations([initialConversation]);
        setActiveConversationId(initialConversation.id);
      }
    } catch (e) {
      console.error("Failed to load chat history", e);
      localStorage.removeItem(CHAT_CONVERSATIONS_STORAGE_KEY);
      localStorage.removeItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY);
      const initialConversation = createConversation();
      setConversations([initialConversation]);
      setActiveConversationId(initialConversation.id);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    try {
      localStorage.setItem(CHAT_CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
      if (activeConversationId) {
        localStorage.setItem(CHAT_ACTIVE_CONVERSATION_STORAGE_KEY, activeConversationId);
      }
    } catch (e) {
      console.error("Failed to persist chat history", e);
    }
  }, [conversations, activeConversationId, isHydrated]);

  useEffect(() => {
    if (!activeConversationId && conversations.length > 0) {
      setActiveConversationId(conversations[0].id);
    }
  }, [activeConversationId, conversations]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isPending]);

  const createNewConversation = () => {
    const conversation = createConversation();
    setConversations((prev) => [conversation, ...prev]);
    setActiveConversationId(conversation.id);
    setError(null);
    setInput("");
  };

  const updateConversationMessages = (conversationId: string, nextMessages: PersistedMessage[]) => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;

        const nextTitle = conversation.title === DEFAULT_TITLE
          ? deriveConversationTitle(nextMessages)
          : conversation.title;

        return {
          ...conversation,
          title: nextTitle,
          messages: nextMessages,
          updatedAt: nowIso(),
        };
      })
    );
  };

  const appendMessageToConversation = (conversationId: string, message: PersistedMessage) => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;

        const nextMessages = [...conversation.messages, message];
        const nextTitle = conversation.title === DEFAULT_TITLE
          ? deriveConversationTitle(nextMessages)
          : conversation.title;

        return {
          ...conversation,
          title: nextTitle,
          messages: nextMessages,
          updatedAt: nowIso(),
        };
      })
    );
  };

  const handleDeleteConversation = (conversationId: string) => {
    const remaining = conversations.filter((conversation) => conversation.id !== conversationId);

    if (remaining.length === 0) {
      const fallback = createConversation();
      setConversations([fallback]);
      setActiveConversationId(fallback.id);
    } else {
      setConversations(remaining);
      if (activeConversationId === conversationId) {
        const sortedRemaining = [...remaining].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setActiveConversationId(sortedRemaining[0].id);
      }
    }

    toast({
      title: "Gesprek verwijderd",
      description: "Het gesprek is verwijderd uit lokale geschiedenis.",
    });
  };

  const handleClearActiveConversation = () => {
    if (!activeConversationId) return;

    updateConversationMessages(activeConversationId, []);
    setError(null);
    toast({
      title: "Gesprek gewist",
      description: "Het actieve gesprek is leeggemaakt.",
    });
  };

  const handleDownload = () => {
    if (!activeConversation) return;

    const chatContent = activeConversation.messages
      .map((message) => `[${message.role === "user" ? "Gebruiker" : "Expert"}]\n${message.content}`)
      .join("\n\n---------------------------------\n\n");

    const blob = new Blob([chatContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-${activeConversation.id}-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveToCloud = async () => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Niet ingelogd",
        description: "Log in om gesprekken permanent op te slaan.",
      });
      return;
    }
    if (cloudArchiveBlocked) {
      toast({
        variant: "destructive",
        title: "Cloudarchief niet beschikbaar",
        description: "Firestore rules blokkeren chat_sessions. Lokale geschiedenis blijft wel werken.",
      });
      return;
    }
    if (!activeConversation) return;
    if (activeConversation.messages.length === 0) {
      toast({
        variant: "destructive",
        title: "Geen berichten",
        description: "Het actieve gesprek is leeg en kan niet worden opgeslagen.",
      });
      return;
    }

    const payload = {
      userId: user.uid,
      title: activeConversation.title,
      messages: activeConversation.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      messageCount: activeConversation.messages.length,
      localConversationId: activeConversation.id,
      source: "expert-chat",
      updatedAt: serverTimestamp(),
    };

    setIsSavingCloud(true);
    try {
      if (activeConversation.cloudDocId) {
        const sessionRef = doc(firestore, "chat_sessions", user.uid, "sessions", activeConversation.cloudDocId);
        await setDoc(sessionRef, payload, { merge: true });
      } else {
        const sessionsCol = collection(firestore, "chat_sessions", user.uid, "sessions");
        const created = await addDoc(sessionsCol, {
          ...payload,
          createdAt: serverTimestamp(),
        });

        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  cloudDocId: created.id,
                  cloudSavedAt: nowIso(),
                }
              : conversation
          )
        );
      }

      if (activeConversation.cloudDocId) {
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === activeConversation.id
              ? {
                  ...conversation,
                  cloudSavedAt: nowIso(),
                }
              : conversation
          )
        );
      }

      toast({
        title: "Gesprek opgeslagen",
        description: "Het actieve gesprek is opgeslagen in je cloudarchief.",
      });
    } catch (e) {
      const description = e instanceof Error ? e.message : "Onbekende fout tijdens opslaan.";
      toast({
        variant: "destructive",
        title: "Opslaan mislukt",
        description,
      });
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handleRestoreCloudSession = (session: any) => {
    const sessionMessages = sanitizeMessages(session?.messages);
    if (sessionMessages.length === 0) {
      toast({
        variant: "destructive",
        title: "Kan niet herstellen",
        description: "Dit cloudgesprek bevat geen geldige berichten.",
      });
      return;
    }

    const existingLocal = conversations.find((conversation) => conversation.cloudDocId === session.id);
    if (existingLocal) {
      setActiveConversationId(existingLocal.id);
      toast({
        title: "Gesprek geopend",
        description: "Bestaande lokale versie van dit cloudgesprek is geopend.",
      });
      return;
    }

    const restoredConversation: ChatConversation = {
      id: createConversationId(),
      title: typeof session?.title === "string" && session.title.trim().length > 0
        ? session.title
        : deriveConversationTitle(sessionMessages),
      messages: sessionMessages,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      cloudDocId: typeof session?.id === "string" ? session.id : undefined,
      cloudSavedAt: nowIso(),
    };

    setConversations((prev) => [restoredConversation, ...prev]);
    setActiveConversationId(restoredConversation.id);

    toast({
      title: "Cloudgesprek hersteld",
      description: "Het gesprek is toegevoegd aan je lokale geschiedenis.",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isPending || !activeConversationId || !activeConversation) return;

    const question = input.trim();
    const conversationId = activeConversationId;
    const userMessage: PersistedMessage = { role: "user", content: question };
    const currentMessages = [...activeConversation.messages, userMessage];

    updateConversationMessages(conversationId, currentMessages);
    setInput("");
    setError(null);

    startTransition(async () => {
      const { data, error: chatError } = await getExpertChatResponse({
        history: currentMessages as Message[],
        question,
      });

      if (chatError) {
        setError(chatError);
        return;
      }

      if (data) {
        const assistantMessage: PersistedMessage = { role: "model", content: data.answer };
        appendMessageToConversation(conversationId, assistantMessage);
      }
    });
  };

  return (
    <div className="container mx-auto flex h-[calc(100vh-4rem)] flex-col p-4 md:p-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/" passHref>
          <Button variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Terug naar Home
          </Button>
        </Link>
        <Button variant="secondary" onClick={createNewConversation}>
          <Plus className="mr-2 h-4 w-4" />
          Nieuw gesprek
        </Button>
      </div>

      <Card className="flex flex-1 flex-col shadow-lg">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare />
                Chat / Vraag Expert
              </CardTitle>
              <CardDescription>
                Gesprekken blijven lokaal bewaard. Ingelogde gebruikers kunnen ook opslaan in cloudarchief.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={handleDownload}
                disabled={messages.length === 0}
                title="Download actief gesprek"
              >
                <Download className="h-4 w-4" />
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={handleSaveToCloud}
                disabled={!user || isSavingCloud || messages.length === 0 || cloudArchiveBlocked}
                title={
                  !user
                    ? "Log in om op te slaan"
                    : cloudArchiveBlocked
                      ? "Cloudarchief geblokkeerd door Firestore rules"
                      : "Opslaan in cloud"
                }
              >
                {isSavingCloud ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudUpload className="h-4 w-4" />
                )}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={messages.length === 0}
                    title="Wis actief gesprek"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Actief gesprek wissen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Dit leegt alleen het actieve gesprek. Andere gesprekken in de geschiedenis blijven bewaard.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuleren</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearActiveConversation}>Bevestigen</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-0">
          <div className="grid h-full md:grid-cols-[280px_1fr]">
            <aside className="border-b p-3 md:border-b-0 md:border-r">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Lokale gesprekken</h3>
                <span className="text-xs text-muted-foreground">{conversations.length}</span>
              </div>

              <ScrollArea className="h-44 md:h-[calc(100vh-22rem)] pr-2">
                <div className="space-y-2">
                  {sortedConversations.map((conversation) => {
                    const isActive = conversation.id === activeConversationId;

                    return (
                      <div key={conversation.id} className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => setActiveConversationId(conversation.id)}
                          className={`flex-1 rounded-md border p-2 text-left transition ${
                            isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                          }`}
                        >
                          <p className="truncate text-sm font-medium">{conversation.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {conversation.messages.length} berichten · {formatDateLabel(conversation.updatedAt)}
                          </p>
                        </button>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Verwijder gesprek"
                          onClick={() => handleDeleteConversation(conversation.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="mt-5 border-t pt-4">
                <h3 className="mb-2 text-sm font-semibold">Cloudarchief</h3>
                {!user && (
                  <p className="text-xs text-muted-foreground">
                    Log in om gesprekken permanent op te slaan en later te herstellen.
                  </p>
                )}

                {user && (
                  <>
                    {isCloudSessionsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cloudgesprekken laden...
                      </div>
                    ) : cloudArchiveBlocked ? (
                      <p className="text-xs text-destructive">
                        Cloudarchief is geblokkeerd door Firestore rules. Lokale geschiedenis blijft actief.
                      </p>
                    ) : (
                      <ScrollArea className="h-36 pr-2">
                        <div className="space-y-2">
                          {(cloudSessions ?? []).slice(0, 20).map((session) => (
                            <button
                              type="button"
                              key={session.id}
                              onClick={() => handleRestoreCloudSession(session)}
                              className="w-full rounded-md border border-border p-2 text-left transition hover:bg-muted/60"
                            >
                              <p className="truncate text-sm font-medium">{session.title || "Ongetiteld gesprek"}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {session.messageCount ?? sanitizeMessages(session.messages).length} berichten · {formatDateLabel(session.updatedAt)}
                              </p>
                            </button>
                          ))}

                          {(cloudSessions ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">Nog geen cloudgesprekken opgeslagen.</p>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </>
                )}
              </div>
            </aside>

            <div className="relative">
              <ScrollArea className="h-full w-full p-4 md:p-6" ref={scrollAreaRef}>
                <div className="mb-4">
                  <p className="text-sm font-semibold">{activeConversation?.title ?? DEFAULT_TITLE}</p>
                  <p className="text-xs text-muted-foreground">
                    Laatst bijgewerkt: {formatDateLabel(activeConversation?.updatedAt ?? null)}
                  </p>
                </div>

                <div className="space-y-6">
                  {messages.map((message, index) => (
                    <div
                      key={`${index}-${message.role}`}
                      className={`flex items-start gap-3 ${message.role === "user" ? "justify-end" : ""}`}
                    >
                      {message.role === "model" && (
                        <Avatar className="h-8 w-8 border-2 border-primary bg-background p-1">
                          <AvatarImage src="https://i.imgur.com/WlSEJ5L.png" alt="Engineer Flow Logo" />
                          <AvatarFallback>
                            <BrainCircuit className="text-primary" />
                          </AvatarFallback>
                        </Avatar>
                      )}

                      <div
                        className={`max-w-md rounded-lg p-3 ${
                          message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                      </div>

                      {message.role === "user" && (
                        <Avatar className="h-8 w-8">
                          <AvatarFallback>
                            <User />
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  ))}

                  {isPending && (
                    <div className="flex items-start gap-3">
                      <Avatar className="h-8 w-8 border-2 border-primary bg-background p-1">
                        <AvatarImage src="https://i.imgur.com/WlSEJ5L.png" alt="Engineer Flow Logo" />
                        <AvatarFallback>
                          <BrainCircuit className="text-primary" />
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex items-center space-x-2 rounded-lg bg-muted p-3">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span className="text-sm text-muted-foreground">Analyseren...</span>
                      </div>
                    </div>
                  )}

                  {messages.length === 0 && !isPending && (
                    <div className="pt-16 text-center text-muted-foreground">
                      <MessageSquare className="mx-auto mb-2 h-12 w-12" />
                      <p>Stel je eerste vraag. Dit gesprek wordt bewaard in je geschiedenis.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-4 border-t p-4">
          {error && (
            <Alert variant="destructive" className="w-full">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Fout opgetreden</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="flex w-full items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Vraag bijvoorbeeld: 'Wat doet de PTO precies?'"
              disabled={isPending || !activeConversationId}
              autoComplete="off"
            />
            <Button type="submit" size="icon" disabled={isPending || !input.trim() || !activeConversationId}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
