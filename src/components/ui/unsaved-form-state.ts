/**
 * Lê também controles desabilitados durante o envio e inputs ocultos de menus.
 *
 * O que estiver dentro de `[data-unsaved-ignore]` não conta: serve para um
 * trecho que carrega sozinho depois de a tela abrir (a lista de grupos do
 * WhatsApp, por exemplo). Sem isso os campos que aparecem no carregamento
 * fariam o formulário parecer alterado sem ninguém ter mexido. A escolha em si
 * precisa continuar espelhada num campo fora da área, para contar como mudança.
 */
export function snapshotForm(form: HTMLFormElement | null): string {
  if (!form) return "";
  return JSON.stringify(Array.from(form.elements).flatMap<unknown>((element, index) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return [];
    if (element instanceof HTMLInputElement && ["submit", "button", "reset"].includes(element.type)) return [];
    if (element.closest("[data-unsaved-ignore]")) return [];
    const key = element.name || element.id || String(index);
    if (element instanceof HTMLInputElement) {
      if (["checkbox", "radio"].includes(element.type)) return [[key, element.value, element.checked]];
      if (element.type === "file") return [[key, Array.from(element.files ?? []).map((file) => [file.name, file.size, file.lastModified])]];
    }
    if (element instanceof HTMLSelectElement && element.multiple) return [[key, Array.from(element.selectedOptions).map((option) => option.value)]];
    return [[key, element.value]];
  }));
}
