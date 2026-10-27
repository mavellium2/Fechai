"use client";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Info, Search, X } from "lucide-react";
const Context = createContext({ toggle: () => {} });
export function ConversationsWorkspace({ sidebar, thread, contact, selected }: { sidebar: ReactNode; thread: ReactNode; contact: ReactNode; selected: boolean }) {
  const [contactOpen, setContactOpen] = useState(false);
  const [contactClosed, setContactClosed] = useState(false);
  const toggle = () => { setContactOpen(v => !v); setContactClosed(v => !v); };
  return <Context value={{ toggle }}><div className={`conversations-workspace ${selected ? "conversation-selected" : ""} ${contactClosed ? "contact-closed" : ""} ${contactOpen ? "contact-open" : ""}`}><aside className="conversation-sidebar">{sidebar}</aside><section className="conversation-main" aria-label="Conversa selecionada">{thread}</section><aside className="conversation-contact" aria-label="Sobre o contato"><header><h2>Sobre o contato</h2><button className="tenant-icon-button" aria-label="Fechar informações do contato" onClick={() => { setContactOpen(false); setContactClosed(true); }}><X size={15} /></button></header><div className="conversation-contact-content">{contact}</div></aside></div></Context>;
}
export function ConversationToolbar() {
  const context = useContext(Context);
  const input = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [result, setResult] = useState("");
  const cursor = useRef(0);
  return <div className="conversation-toolbar"><details open={searchOpen} onToggle={e => setSearchOpen(e.currentTarget.open)}><summary><Search size={14} />Buscar</summary><form role="search" onSubmit={e => { e.preventDefault(); const term = input.current?.value.trim().toLocaleLowerCase("pt-BR"); if (!term) return; const scope = e.currentTarget.closest(".conversation-main"); const matches = Array.from(scope?.querySelectorAll<HTMLElement>("[data-message-content]") ?? []).filter(node => node.textContent?.toLocaleLowerCase("pt-BR").includes(term)); if (matches.length) { const match = matches[cursor.current % matches.length]; match.scrollIntoView({ behavior: "smooth", block: "center" }); match.focus({ preventScroll: true }); cursor.current += 1; } setResult(matches.length ? `${(cursor.current - 1) % matches.length + 1} de ${matches.length}` : "Nenhum resultado"); }}><input ref={input} aria-label="Buscar nas mensagens" placeholder="Texto da mensagem" onChange={() => { cursor.current = 0; setResult(""); }} /><button>Encontrar</button><span role="status">{result}</span></form></details><button className="tenant-icon-button" aria-label="Mostrar ou ocultar informações do contato" onClick={context.toggle}><Info size={18} /></button></div>;
}
