"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

export function CrmLeadDrawer({ title, back, children }: { title: string; back: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby="crm-lead-title" onCancel={(event) => {
      event.preventDefault();
      router.push(back);
    }} className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto overscroll-contain bg-white text-ink shadow-2xl backdrop:bg-ink/55 panel:bg-ink panel:text-white sm:max-w-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-ink/10 bg-white px-4 py-3 panel:border-white/10 panel:bg-ink sm:px-6">
        <h2 id="crm-lead-title" className="min-w-0 font-display text-xl font-semibold [overflow-wrap:anywhere]">{title}</h2>
        <ButtonLink href={back} variant="ghost" size="icon" aria-label="Voltar ao quadro"><X size={20} aria-hidden /></ButtonLink>
      </div>
      <div className="space-y-6 p-4 sm:p-6">{children}</div>
    </dialog>
  );
}
