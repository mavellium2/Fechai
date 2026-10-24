"use client";

import { useRouter } from "next/navigation";
import { useSaveFeedback } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { markSurveyReviewedAction } from "../relatorios/actions";

/** Marca uma avaliação baixa como revisada: ela sai do alerta do início. */
export function ReviewSurveyButton({ surveyId }: { surveyId: string }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "avaliação", gender: "f", action: "update" });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      loading={save.saving}
      loadingLabel="Salvando"
      onClick={() =>
        void save.run(async () => {
          const res = await markSurveyReviewedAction(surveyId);
          if (res.ok) router.refresh();
          return res;
        })
      }
    >
      Revisada
    </Button>
  );
}
