import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { phoneLabel } from "@/lib/format";
import { CONTACT_NAME_MAX, CONTACT_VALUE_MAX, type ContactProfileData } from "@/modules/crm/contact-profile-shape";

function EditedMark() {
  return <span className="font-normal text-xs text-iris">· editado pela equipe</span>;
}

/**
 * Campos do formulário de dados do contato (CRM e Contatos). O original do
 * WhatsApp aparece em cima, só para leitura; embaixo o que vale, editável.
 * Sem hook: serve dentro de qualquer `<form>`, de diálogo ou de painel.
 */
export function ContactProfileFields({ idPrefix, data }: { idPrefix: string; data: ContactProfileData }) {
  const nameId = `${idPrefix}-nome`;
  return (
    <div className="space-y-4">
      <div className="rounded-control border border-ink/10 bg-ink/[0.02] px-3 py-2 text-sm panel:border-white/10 panel:bg-white/[0.03]">
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-neutral panel:text-white/50">Original do WhatsApp</p>
        <dl className="mt-1 grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-neutral panel:text-white/55">Nome no perfil</dt>
          <dd className="[overflow-wrap:anywhere]">{data.whatsappName || <span className="text-neutral panel:text-white/45">não recebido</span>}</dd>
          <dt className="text-neutral panel:text-white/55">Telefone</dt>
          <dd>{phoneLabel(data.phone)}</dd>
        </dl>
      </div>

      <Field label="Nome" htmlFor={nameId} optional
        hint={`Vale no painel, nos avisos e no {{nome}} do agente. Em branco, volta ao nome do WhatsApp.`}
        about={data.nameEdited ? "Este nome foi definido pela equipe: o agente não troca mais." : undefined}>
        <Input {...fieldProps(nameId, { hint: true })} name="name" maxLength={CONTACT_NAME_MAX}
          defaultValue={data.name} placeholder={data.whatsappName ?? "Ex.: Ana Souza"} autoComplete="off" />
      </Field>

      {data.fields === null ? (
        <p className="text-sm text-neutral panel:text-white/55">As variáveis do agente aparecem depois da primeira conversa com este contato.</p>
      ) : data.fields.map((field) => {
        const id = `${idPrefix}-var-${field.key}`;
        return (
          <div key={field.key}>
            <Field label={`{{${field.key}}}`} htmlFor={id} optional hint={field.description}>
              <Input {...fieldProps(id, { hint: true })} name={`var:${field.key}`} maxLength={CONTACT_VALUE_MAX}
                defaultValue={field.value} placeholder="não informado" autoComplete="off" />
            </Field>
            {field.edited && field.value && <p className="mt-1"><EditedMark /></p>}
          </div>
        );
      })}
    </div>
  );
}
