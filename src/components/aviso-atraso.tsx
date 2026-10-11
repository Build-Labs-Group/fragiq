import { formatarQuando } from "@/lib/sessoes";

/**
 * Aviso discreto de que a Steam não respondeu agora e o que está na tela é o
 * último dado que o FragIQ guardou. Inline, junto do dado (docs/design.md §6):
 * é qualificação da leitura, não um banner da página.
 */
export function AvisoAtraso({
  em,
  className,
}: {
  em: Date;
  className?: string;
}) {
  return (
    <p role="status" className={className ?? "mt-1 text-xs text-warn"}>
      Atualização atrasada, tentando de novo. Estes números são da última
      coleta, em {formatarQuando(em)}.
    </p>
  );
}
