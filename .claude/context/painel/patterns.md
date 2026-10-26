# Painel — padrões
Fontes reais, sem criar domínio fictício em src/modules/painel.

Em `(dashboard)/agentes/page.tsx`:
```tsx
const [agents, usage] = await getAgentsNavigation(tenantId);
```

Em `TenantTheme.tsx`:
```tsx
<Switch checked={dark} onCheckedChange={context.toggle} label="Modo escuro" className="tenant-theme-switch"
  thumbContent={<Icon size={14} strokeWidth={2} aria-hidden />} />
```

- Editores originais dentro de diálogo nativo; fechar passa por useUnsavedNavigation. Sandbox recebe o id selecionado.
- Grade/lista e busca são locais; valores vêm da configuração salva.
- Tokens `--tenant-*` cobrem ambos os temas; ponte de cores legadas só no claro.
- Menu: largura 260ms, rótulos com fade; mobile anima display/overlay. Respeitar prefers-reduced-motion.
- Main é relative para conter elementos absolutos das tabelas no mobile.
- cn registra text-micro em font-size do tailwind-merge: a cor não pode apagar o tamanho.
- Teste da regressão: `tests/ui-class-merge.test.ts`; comandos e limites da conferência no README de Agentes.
