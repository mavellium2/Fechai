"use client";
import { Button } from "@/components/ui/button";
import { useSaveFeedback } from "@/components/ui/toast";
import { setConversationAgentPaused } from "./actions";
export function AssumeConversationButton({ id, paused }: { id: string; paused: boolean }) {
  const save = useSaveFeedback({ entity: "atendimento" });
  return <Button disabled={paused || save.saving} loading={save.saving} onClick={() => save.run(() => setConversationAgentPaused(id, true))}>{paused ? "Atendimento assumido" : "Assumir conversa"}</Button>;
}
