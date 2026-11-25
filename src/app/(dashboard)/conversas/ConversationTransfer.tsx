"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { useSaveFeedback } from "@/components/ui/toast";
import { transferConversation } from "./actions";

type Member = { id: string; name: string };

/**
 * Transferir o atendimento para outra pessoa da equipe (CRM-07). Vai junto quem
 * a tela mostra como responsável: o servidor recusa se ele mudou no meio.
 */
export function ConversationTransfer({ conversationId, assignedUserId, team }: {
  conversationId: string;
  assignedUserId: string;
  team: Member[];
}) {
  const save = useSaveFeedback({ entity: "atendimento" });
  const labelId = `${useId()}-transferir`;
  const [selected, setSelected] = useState("");
  const others = team.filter(({ id }) => id !== assignedUserId);
  if (!others.length) return null;
  const toUserId = others.some(({ id }) => id === selected) ? selected : "";

  async function transfer() {
    const result = await save.run(() => transferConversation(conversationId, toUserId, assignedUserId));
    if (result.ok) setSelected("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="sr-only">Transferir para</span>
      <SelectMenu
        className="min-w-40"
        label="Transferir para"
        labelledBy={labelId}
        value={toUserId}
        onChange={setSelected}
        disabled={save.saving}
        options={[{ value: "", label: "Transferir para…" }, ...others.map(({ id, name }) => ({ value: id, label: name }))]}
      />
      <Button type="button" size="sm" variant="outline" disabled={!toUserId || save.saving} loading={save.saving} onClick={transfer}>
        Transferir
      </Button>
    </div>
  );
}
