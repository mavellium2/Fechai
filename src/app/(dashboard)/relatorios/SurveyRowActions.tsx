"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useSaveFeedback } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { SURVEY_TOPICS } from "@/modules/satisfaction/categories";
import { markSurveyReviewedAction, setSurveyTopicAction } from "./actions";

const OPTIONS = [
  { value: "", label: "Sem motivo (só elogio)" },
  ...SURVEY_TOPICS.map((t) => ({ value: t.key, label: t.label })),
];

/** Corrige o motivo (vale mais que a IA) e marca avaliação baixa como revisada. */
export function SurveyRowActions({
  id,
  topic,
  canReview,
}: {
  id: string;
  /** Motivo atual (a primeira chave), "" quando não há. */
  topic: string;
  canReview: boolean;
}) {
  const router = useRouter();
  const labelId = useId();
  const [value, setValue] = useState(topic);
  const save = useSaveFeedback({ entity: "avaliação", gender: "f", action: "update" });

  function change(next: string) {
    const previous = value;
    setValue(next);
    void save
      .run(async () => {
        const res = await setSurveyTopicAction(id, next);
        if (!res.ok) setValue(previous);
        else router.refresh();
        return res;
      });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span id={labelId} className="sr-only">Motivo da avaliação</span>
      <div className="w-56">
        <SelectMenu label="Motivo da avaliação" labelledBy={labelId} value={value} onChange={change} options={OPTIONS} />
      </div>
      {canReview && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={save.saving}
          loadingLabel="Salvando"
          onClick={() =>
            void save.run(async () => {
              const res = await markSurveyReviewedAction(id);
              if (res.ok) router.refresh();
              return res;
            })
          }
        >
          Marcar como revisada
        </Button>
      )}
    </div>
  );
}
